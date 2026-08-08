import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function DELETE(request: NextRequest) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;
  const session = gate.session;

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
