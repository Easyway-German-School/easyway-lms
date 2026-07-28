import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isLecturer(session.user.id)) return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const body = await request.json();
  const { courseId, title, description, level, published } = body;
  if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });

  try {
    const course = await prisma.course.update({
      where: { id: courseId },
      data: {
        title,
        description,
        level,
        published: published === true,
      }
    });

    return NextResponse.json({ course });
  } catch (error) {
    console.error("Course update error:", error);
    return NextResponse.json({ error: "Failed to update course" }, { status: 500 });
  }
}
