import { getStudentMastery } from '@/lib/skill-mastery';
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { generatePersonalizedPlan } from "@/lib/ai";
import { mayAutoCreateStudent } from "@/lib/candidates";
import { KIND, notify } from "@/lib/notify";
import { readLearningStyle, type LearningStyle, type StyleSeed } from "@/lib/learner-style";
import { profileFor } from "@/lib/learner-intelligence";
import { bestHours } from "@/lib/learner-signals";

/**
 * HOW THIS STUDENT ACTUALLY STUDIES.
 *
 * Pulls the three things the academic scorer never looked at — which lesson
 * format they finish, how long a lesson they see through, whether they push
 * past their level — plus the rhythm the behaviour engine already computed,
 * and hands the lot to `readLearningStyle`. Everything here is best-effort: a
 * failure (no behaviour profile yet, a tenant-scope hiccup) degrades to a
 * null style and the plan is ranked on academics alone, exactly as before.
 */
async function readStudentStyle(
  student: { id: string; userId: string; level: string | null; learningPreferences: unknown },
): Promise<LearningStyle | null> {
  try {
    const [completions, grades, videos, rhythmProfile] = await Promise.all([
      prisma.completion.findMany({
        where: { studentId: student.id },
        orderBy: { startedAt: "desc" },
        take: 120,
        select: {
          lessonId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          score: true,
          lesson: {
            select: {
              type: true,
              duration: true,
              module: { select: { course: { select: { level: true } } } },
            },
          },
        },
      }),
      prisma.grade.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { type: true, score: true, createdAt: true },
      }),
      prisma.videoProgress.findMany({
        where: { studentId: student.id },
        orderBy: { updatedAt: "desc" },
        take: 60,
        select: {
          completed: true,
          positionSeconds: true,
          updatedAt: true,
          material: { select: { durationSeconds: true } },
        },
      }),
      profileFor(student.userId).catch(() => null),
    ]);

    const rhythm = rhythmProfile && rhythmProfile.totalEvents > 0
      ? {
          avgSessionMinutes: rhythmProfile.avgSessionMinutes,
          bestHours: bestHours(rhythmProfile),
          archetype: rhythmProfile.archetype,
          surfaceShare: Object.fromEntries(
            (rhythmProfile.signals?.areaMix ?? []).map((row) => [row.area, row.share]),
          ),
        }
      : null;

    const seedRaw = student.learningPreferences;
    const seed: StyleSeed =
      seedRaw && typeof seedRaw === "object"
        ? {
            format: (seedRaw as Record<string, unknown>).format as string | undefined,
            pace: (seedRaw as Record<string, unknown>).pace as string | undefined,
          }
        : null;

    return readLearningStyle(
      {
        lessonTouches: completions.map((c) => ({
          lessonId: c.lessonId,
          type: c.lesson?.type ?? "lesson",
          status: c.status,
          startedAt: c.startedAt,
          completedAt: c.completedAt,
          nominalMinutes: typeof c.lesson?.duration === "number" ? c.lesson.duration : null,
          score: c.score,
          level: c.lesson?.module?.course?.level ?? null,
        })),
        grades: grades.map((g) => ({ type: g.type, score: g.score, at: g.createdAt })),
        videos: videos.map((v) => ({
          completed: v.completed,
          positionSeconds: v.positionSeconds,
          durationSeconds: v.material?.durationSeconds ?? null,
          at: v.updatedAt,
        })),
        rhythm,
        seed,
        studentLevel: student.level,
      },
    );
  } catch (error) {
    console.warn("[personalize] could not read learning style", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const fallbackPlan = {
    rationale: 'Your personalized learning plan is loading with a safe fallback while the student data service catches up.',
    lessons: [
      { id: 'fallback-lesson-1', title: 'German essentials warm-up', goal: 'Review core vocabulary and pronunciation', duration: 20 },
      { id: 'fallback-lesson-2', title: 'Daily conversation practice', goal: 'Practice a short speaking drill', duration: 20 },
      { id: 'fallback-lesson-3', title: 'Exam readiness checkpoint', goal: 'Review one exam-style task', duration: 20 },
    ],
  };

  try {
    let student = await prisma.student.findUnique({ where: { userId: session.user.id as string } });
    if (!student) {
      // Candidates have no Student record by design.
      if (!(await mayAutoCreateStudent(session.user.id as string))) {
        return NextResponse.json({ error: 'Not a student account' }, { status: 403 });
      }
      student = await prisma.student.create({ data: { userId: session.user.id as string, level: 'A1', pathway: 'Language training' } });
    }

    // Build candidate lessons from pathway + lecturer courses
    const pathway = await prisma.pathway.findUnique({ where: { name: student.pathway }, include: { courses: { include: { modules: { include: { lessons: true } } } } } });
    const lecturerPathway = await prisma.pathway.findUnique({ where: { name: 'Lecturer Uploaded Courses' }, include: { courses: { include: { modules: { include: { lessons: true } } } } } });

    const flattenLessons = (courses: any[] = []) => {
      const lessons: any[] = [];
      for (const course of courses) {
        for (const courseModule of course.modules || []) {
          for (const lesson of courseModule.lessons || []) {
            lessons.push({ id: lesson.id, title: lesson.title, description: lesson.description, order: lesson.order, duration: lesson.duration, type: lesson.type, level: course.level, courseId: course.id, summary: lesson.content?.slice(0, 800) });
          }
        }
      }
      return lessons;
    };

    const uploadedCoursesForLevel = lecturerPathway?.courses.filter((course) => {
      const courseLevel = String(course.level || "").toUpperCase();
      return !courseLevel || courseLevel === String(student.level || "").toUpperCase() || courseLevel === "A1-C2";
    }) || [];
    const candidateLessons = [
      ...flattenLessons(pathway?.courses || []),
      ...flattenLessons(uploadedCoursesForLevel),
    ];

    // Build a richer student profile: completions, recent grades, performance
    const completions = await prisma.completion.findMany({ where: { studentId: student.id }, orderBy: { completedAt: 'desc' }, take: 100 });
    const completedLessons = completions.map((c) => c.lessonId);

    const recentGrades = await prisma.grade.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' }, take: 10 });
      const skillMastery = await getStudentMastery(student.id);
    const averageScore = recentGrades.length ? Math.round(recentGrades.reduce((s, g) => s + (g.score || 0), 0) / recentGrades.length) : null;

    const profile = {
      id: student.id,
      level: student.level,
      pathway: student.pathway,
      germanyGoal: student.germanyGoal,
      germanyGoalNote: student.germanyGoalNote,
      examReadiness: student.examReadiness,
      completedLessons,
      recentPerformance: recentGrades.map((g) => ({ type: g.type, score: g.score, createdAt: g.createdAt })),
      averageScore,
      skillMastery,
    };

    // Enrich candidate lessons with summary and simple tags
    const enrichedCandidates = [] as any[];
    for (const lesson of candidateLessons) {
      const tags = Array.from(new Set(((lesson.summary || lesson.description || '')
        .match(/\b[A-ZÄÖÜ][a-zäöüß]{2,}\b/g) || [])
        .slice(0, 6)));
      enrichedCandidates.push({ ...lesson, tags, summary: lesson.summary || (lesson.description || '').slice(0, 400) });
    }

    // Check if cached plan exists and is recent (< 1 hour old)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const cachedPlan = await prisma.personalizedPlan.findUnique({ where: { studentId: student.id } });

    const newestCourse = await prisma.course.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (cachedPlan && cachedPlan.updatedAt > oneHourAgo && (!newestCourse || cachedPlan.updatedAt >= newestCourse.createdAt)) {
      try {
        const plan = JSON.parse(cachedPlan.plan);
        return NextResponse.json({ plan, source: 'cache' });
      } catch {
        // invalid cache, regenerate
      }
    }

    // Generate new plan and cache it
    const requestedStrategy = request.nextUrl.searchParams.get('strategy') || process.env.PERSONALIZATION_PLANNER_STRATEGY || 'hybrid';
    const compareStrategies = request.nextUrl.searchParams.get('compare') === 'true';
    const strategiesToRun = compareStrategies ? ['deterministic', 'hybrid'] : [requestedStrategy];

    // Read taste once and reuse it across every strategy in this request.
    const learningStyle = await readStudentStyle(student);

    const generatedPlans = await Promise.all(
      strategiesToRun.map(async (strategyName) => ({
        strategy: strategyName,
        plan: await generatePersonalizedPlan(profile, enrichedCandidates, {
          maxLessons: 12,
          minutesPerDay: 30,
          strategy: strategyName,
          styleSignals: learningStyle,
        }),
      }))
    );

    const primaryPlan = generatedPlans.find((item) => item.strategy === requestedStrategy)?.plan || generatedPlans[0].plan;
    const comparison = Object.fromEntries(generatedPlans.map((item) => [item.strategy, item.plan]));

    try {
      await prisma.personalizedPlan.upsert({
        where: { studentId: student.id },
        update: { plan: JSON.stringify(primaryPlan), updatedAt: new Date() },
        create: { studentId: student.id, plan: JSON.stringify(primaryPlan) }
      });
    } catch (err) {
      console.error('Failed to cache personalized plan', err);
    }

    const firstLesson = Array.isArray(primaryPlan.lessons) ? primaryPlan.lessons[0] : null;
    void notify({
      to: { studentIds: [student.id] },
      kind: KIND.general,
      severity: "info",
      title: "Your learning plan is ready",
      message: firstLesson?.title
        ? `Your next recommended step is ${String(firstLesson.title).slice(0, 100)}.`
        : "Your personalized learning plan has been refreshed.",
      link: "/lesson",
      dedupeKey: `personalized-plan:${student.id}:${new Date().toISOString().slice(0, 10)}`,
      push: false,
      email: false,
    }).catch((error) => console.error("Personalized plan notification failed", error));

    return NextResponse.json({ plan: primaryPlan, source: 'regenerated', comparison, strategy: requestedStrategy, compare: compareStrategies });
  } catch (error) {
    console.error('Personalize API fallback triggered:', error);
    return NextResponse.json({ plan: fallbackPlan, source: 'fallback', strategy: 'fallback' });
  }
}
