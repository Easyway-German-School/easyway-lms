import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isLecturer(session.user.id)) return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const body = await request.json();
  const lessonId = body.lessonId as string;
  if (!lessonId) return NextResponse.json({ error: "lessonId required" }, { status: 400 });

  try {
    await prisma.lesson.delete({ where: { id: lessonId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete lesson error:", error);
    return NextResponse.json({ error: "Failed to delete lesson" }, { status: 500 });
  }
}
