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
  if (!(await isLecturer(session.user.id)))
    return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  if (!courseId) return NextResponse.json({ error: "courseId required" }, { status: 400 });

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  try {
    /**
     * Take this course's materials with it.
     *
     * `Course.delete` is soft (prisma-guard), and a soft delete does not
     * cascade — but the student materials query matches on `course: { level }`,
     * a nested relation filter the guard cannot fold `deletedAt: null` into. So
     * without this the files of a "deleted" course would still be handed to
     * every student at that level. Soft-deleting the rows keeps them
     * restorable while removing them from every list.
     */
    await prisma.material.updateMany({
      where: { courseId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    await prisma.course.delete({ where: { id: courseId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete course error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete course" },
      { status: 500 },
    );
  }
}
