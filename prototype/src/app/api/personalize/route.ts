import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { generatePersonalizedPlan } from "@/lib/ai";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
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
      student = await prisma.student.create({ data: { userId: session.user.id as string, level: 'A1', pathway: 'Goethe exam mastery' } });
    }

    // Build candidate lessons from pathway + lecturer courses
    const pathway = await prisma.pathway.findUnique({ where: { name: student.pathway }, include: { courses: { include: { modules: { include: { lessons: true } } } } } });
    const lecturerPathway = await prisma.pathway.findUnique({ where: { name: 'Lecturer Uploaded Courses' }, include: { courses: { include: { modules: { include: { lessons: true } } } } } });

    const flattenLessons = (courses: any[] = []) => {
      const lessons: any[] = [];
      for (const course of courses) {
        for (const module of course.modules || []) {
          for (const lesson of module.lessons || []) {
            lessons.push({ id: lesson.id, title: lesson.title, description: lesson.description, order: lesson.order, duration: lesson.duration, type: lesson.type, level: course.level, courseId: course.id, summary: lesson.content?.slice(0, 800) });
          }
        }
      }
      return lessons;
    };

    const candidateLessons = [
      ...flattenLessons(pathway?.courses || []),
      ...flattenLessons(lecturerPathway?.courses || []),
    ];

    // Build a richer student profile: completions, recent grades, performance
    const completions = await prisma.completion.findMany({ where: { studentId: student.id }, orderBy: { completedAt: 'desc' }, take: 100 });
    const completedLessons = completions.map((c) => c.lessonId);

    const recentGrades = await prisma.grade.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    const averageScore = recentGrades.length ? Math.round(recentGrades.reduce((s, g) => s + (g.score || 0), 0) / recentGrades.length) : null;

    const profile = {
      id: student.id,
      level: student.level,
      pathway: student.pathway,
      examReadiness: student.examReadiness,
      completedLessons,
      recentPerformance: recentGrades.map((g) => ({ type: g.type, score: g.score, createdAt: g.createdAt })),
      averageScore,
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

    if (cachedPlan && cachedPlan.updatedAt > oneHourAgo) {
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

    const generatedPlans = await Promise.all(
      strategiesToRun.map(async (strategyName) => ({
        strategy: strategyName,
        plan: await generatePersonalizedPlan(profile, enrichedCandidates, { maxLessons: 12, minutesPerDay: 30, strategy: strategyName }),
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

    return NextResponse.json({ plan: primaryPlan, source: 'regenerated', comparison, strategy: requestedStrategy, compare: compareStrategies });
  } catch (error) {
    console.error('Personalize API fallback triggered:', error);
    return NextResponse.json({ plan: fallbackPlan, source: 'fallback', strategy: 'fallback' });
  }
}
