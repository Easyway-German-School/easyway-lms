import { NextResponse } from "next/server";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { readAssignment } from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const allowedBranchIds = scopedBranchIds(gate.admin);
  const lecturers = await prisma.lecturer.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
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
      user: { select: { name: true, email: true } },
    },
  });
  const rows = lecturers
    .map((lecturer) => ({ lecturer, assignment: readAssignment(lecturer) }))
    .filter(
      ({ assignment }) =>
        !allowedBranchIds || assignment.branchIds.some((branchId) => allowedBranchIds.includes(branchId)),
    )
    .map(({ lecturer, assignment }) => ({
      id: lecturer.id,
      status: lecturer.status,
      user: lecturer.user,
      assignment,
    }));

  return NextResponse.json({ lecturers: rows });
}
