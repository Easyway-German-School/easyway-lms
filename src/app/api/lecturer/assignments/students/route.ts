import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { readAssignment, studentWhereForLecturerScope, belongsToLecturer } from "@/lib/lecturer-assignment";

/**
 * The names for the "who gets this?" picker.
 *
 * Its own endpoint rather than reusing /api/lecturer/students, which returns
 * payments, attendance and certificate counts for each person. A picker needs
 * three fields, and sending a student's fee history to render a checkbox is
 * both slow and more of their record on the wire than the job requires.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return NextResponse.json({ error: "Staff access required" }, { status: 403 });
  }

  const level = req.nextUrl.searchParams.get("level");
  const branchId = req.nextUrl.searchParams.get("branchId");
  const sessionSlot = req.nextUrl.searchParams.get("sessionSlot") ?? null;
  if (!level) return NextResponse.json({ students: [] });

  const lecturer = await prisma.lecturer.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      assignmentGroups: true,
      classTypes: true,
      batches: true,
    },
  });

  const assignment = lecturer ? readAssignment(lecturer) : null;
  const where = lecturer && assignment
    ? studentWhereForLecturerScope(assignment, lecturer.id, { level, branchId, sessionSlot })
    : { level: level.toUpperCase(), ...(branchId ? { branchId } : {}), ...(sessionSlot ? { sessionSlot } : {}) };

  if (!where) {
    return NextResponse.json({ students: [] });
  }

  const students = await prisma.student.findMany({
    where: { ...(where as Record<string, unknown>), status: "active" } as any,
    orderBy: [{ user: { name: "asc" } }],
    select: {
      id: true,
      studentCode: true,
      sessionSlot: true,
      level: true,
      tutorId: true,
      user: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  const filtered = assignment && lecturer
    ? students.filter((student) => belongsToLecturer(assignment, lecturer.id, student))
    : students;

  return NextResponse.json({
    students: filtered.map((student) => ({
      id: student.id,
      name: student.user?.name ?? "Unnamed student",
      studentCode: student.studentCode,
      sessionSlot: student.sessionSlot,
      level: student.level,
      branchName: student.branch?.name ?? null,
    })),
  });
}
