import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { generatePersonalizedPlan } from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lessonId = request.nextUrl.searchParams.get("lessonId");
  if (!lessonId) {
    return NextResponse.json({ error: "lessonId required" }, { status: 400 });
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: {
        include: {
          course: true
        }
      }
    }
  });

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string }
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const completion = await prisma.completion.findUnique({
    where: {
      studentId_lessonId: {
        studentId: student.id,
        lessonId
      }
    }
  });

  return NextResponse.json({
    lesson,
    completion,
    course: lesson.module.course
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { lessonId, score, feedback } = body;

  if (!lessonId) {
    return NextResponse.json({ error: "lessonId required" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string }
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const completion = await prisma.completion.upsert({
    where: {
      studentId_lessonId: {
        studentId: student.id,
        lessonId
      }
    },
    update: {
      status: "completed",
      score: score || null,
      feedback: feedback || null,
      completedAt: new Date()
    },
    create: {
      studentId: student.id,
      lessonId,
      status: "completed",
      score: score || null,
      feedback: feedback || null,
      completedAt: new Date()
    }
  });

  // Invalidate cached personalized plan after completion (feedback loop)
  try {
    await prisma.personalizedPlan.deleteMany({ where: { studentId: student.id } });
  } catch (err) {
    console.error('Failed to invalidate plan cache', err);
  }

  // Regenerate personalized plan after completion (feedback loop)
  try {
    const completions = await prisma.completion.findMany({ where: { studentId: student.id } });
    const completedLessons = completions.map((c) => c.lessonId);

    const recentGrades = await prisma.grade.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    const avgScore = recentGrades.length ? Math.round(recentGrades.reduce((s, g) => s + (g.score || 0), 0) / recentGrades.length) : null;

    // Build candidate lessons (pathway + lecturer)
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
    const candidates = [...flattenLessons(pathway?.courses || []), ...flattenLessons(lecturerPathway?.courses || [])];

    const profile = { id: student.id, level: student.level, pathway: student.pathway, examReadiness: student.examReadiness, completedLessons, recentPerformance: recentGrades.map(g=>({type:g.type,score:g.score})), averageScore: avgScore };
    const plan = await generatePersonalizedPlan(profile, candidates, { maxLessons: 12, minutesPerDay: 30 });
    return NextResponse.json({ completion, plan });
  } catch (err) {
    return NextResponse.json({ completion });
  }
}
