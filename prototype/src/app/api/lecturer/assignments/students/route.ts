import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { readAssignment, studentWhereForLecturerScope, belongsToLecturer } from "@/lib/lecturer-assignment";
import { batchOfAdmission } from "@/lib/class-batch";

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
    select: { role: true, tenantId: true, lecturer: { select: { id: true } } },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return NextResponse.json({ error: "Staff access required" }, { status: 403 });
  }
  if (role === "lecturer" && !user?.lecturer?.id) {
    return NextResponse.json({ error: "Tutor account is not linked to a lecturer profile" }, { status: 403 });
  }

  const level = req.nextUrl.searchParams.get("level");
  const branchId = req.nextUrl.searchParams.get("branchId");
  const sessionSlot = req.nextUrl.searchParams.get("sessionSlot") ?? null;
  const batch = req.nextUrl.searchParams.get("batch")?.trim() || null;
  if (!level) return NextResponse.json({ students: [] });

  const lecturer = role === "lecturer"
    ? await prisma.lecturer.findUnique({
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
          pathways: true,
        },
      })
    : null;
  if (role === "lecturer" && !lecturer) {
    return NextResponse.json({ error: "Tutor account is not linked to a lecturer profile" }, { status: 403 });
  }

  const assignment = lecturer ? readAssignment(lecturer) : null;
  const onlineBranchId = await resolveOnlineBranchId(user?.tenantId ?? null);
  const where = lecturer && assignment
    ? studentWhereForLecturerScope(assignment, lecturer.id, { level, branchId, sessionSlot, onlineBranchId })
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
      admission: true,
      tutorId: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
      coTutors: { select: { lecturerId: true } },
      user: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  const filtered = assignment && lecturer
    ? students.filter(
        (student) =>
          belongsToLecturer(assignment, lecturer.id, student) &&
          (!batch || batchOfAdmission(student.admission).toLowerCase() === batch.toLowerCase()),
      )
    : students;

  return NextResponse.json({
    students: filtered.map((student) => ({
      id: student.id,
      name: student.user?.name ?? "Unnamed student",
      studentCode: student.studentCode,
      sessionSlot:
        branchId === onlineBranchId && student.deliveryMode === "hybrid"
          ? student.hybridOnlineSlot ?? student.sessionSlot
          : student.sessionSlot,
      level: student.level,
      // "September" — so the picker can say which batch each name is in and select a whole one.
      batch: batchOfAdmission(student.admission),
      branchName: student.branch?.name ?? null,
    })),
  });
}
