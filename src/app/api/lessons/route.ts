import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courseId = request.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" }
          }
        }
      }
    }
  });

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string }
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Get student completions for this course
  const completions = await prisma.completion.findMany({
    where: { studentId: student.id }
  });

  const completionMap = new Map(completions.map(c => [c.lessonId, c]));

  const modulesWithStatus = course.modules.map(mod => ({
    ...mod,
    lessons: mod.lessons.map(lesson => ({
      ...lesson,
      completion: completionMap.get(lesson.id) || null
    }))
  }));

  return NextResponse.json({
    course,
    modules: modulesWithStatus,
    totalLessons: course.modules.reduce((acc, m) => acc + m.lessons.length, 0),
    completedLessons: completions.length
  });
}
