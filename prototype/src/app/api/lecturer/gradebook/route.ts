import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role === "LECTURER" || user.role === "ADMIN");
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isLecturer(session.user.id)) return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  try {
    const pathway = await prisma.pathway.findUnique({
      where: { name: "Lecturer Uploaded Courses" },
      include: { courses: true }
    });

    if (!pathway || !pathway.courses.length) {
      return NextResponse.json({ courses: [] });
    }

    const courses = await Promise.all(
      pathway.courses.map(async (course) => {
        const progressRecords = await prisma.progress.findMany({
          where: { courseId: course.id },
          include: { student: { include: { user: true } } }
        });

        const lessons = await prisma.lesson.findMany({
          where: { module: { courseId: course.id } },
          select: { id: true }
        });
        const lessonIds = lessons.map((l) => l.id);

        const completions = await prisma.completion.findMany({
          where: { lessonId: { in: lessonIds } },
          include: { student: { include: { user: true } } }
        });

        const studentProgress = progressRecords.map((pr) => ({
          studentName: pr.student.user.name,
          studentEmail: pr.student.user.email,
          percentComplete: pr.percentComplete,
          lessonsCompleted: completions.filter((c) => c.studentId === pr.studentId).length,
          totalLessons: lessons.length
        }));

        return {
          id: course.id,
          title: course.title,
          level: course.level,
          students: studentProgress
        };
      })
    );

    return NextResponse.json({ courses });
  } catch (error) {
    console.error("Gradebook error:", error);
    return NextResponse.json({ error: "Failed to load gradebook" }, { status: 500 });
  }
}
