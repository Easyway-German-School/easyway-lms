import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { tenantWhere } from "@/lib/auth";
import {
  BATCHES,
  COURSE_LEVELS,
  SESSION_SLOTS,
  describeAssignment,
  isAssigned,
  readAssignment,
} from "@/lib/lecturer-assignment";
import { readLecturerStatus } from "@/lib/lecturer-status";

/**
 * Everything the office material uploader needs to describe an audience:
 * the branches, the tutors (with a plain-language summary of what each one
 * teaches), and the closed vocabularies for level / sitting / batch.
 *
 * Gated on `materials` rather than `staff` on purpose — a secretary who can
 * upload course material must be able to aim it, and the secretary preset has
 * `materials` but not `staff`.
 */
export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const [branches, lecturers] = await Promise.all([
    prisma.branch.findMany({
      where: tenantWhere(gate.session.user.tenantId),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lecturer.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const branchNames = new Map(branches.map((b) => [b.id, b.name]));

  const tutors = lecturers
    .map((lecturer) => {
      const assignment = readAssignment(lecturer);
      return {
        lecturerId: lecturer.id,
        userId: lecturer.user?.id ?? null,
        name: lecturer.user?.name ?? lecturer.user?.email ?? "Unnamed tutor",
        status: readLecturerStatus(lecturer.status),
        assigned: isAssigned(assignment),
        assignmentLabel: describeAssignment(assignment, branchNames),
        branchIds: assignment.branchIds,
        levels: assignment.levels,
        sessionSlots: assignment.sessionSlots,
        batches: assignment.batches,
      };
    })
    // A tutor the office has switched off can't act on an upload — leave them
    // out of the picker rather than let material be aimed at a dead account.
    .filter((tutor) => tutor.status !== "inactive");

  return NextResponse.json({
    branches,
    tutors,
    levels: COURSE_LEVELS,
    sessionSlots: SESSION_SLOTS,
    batches: BATCHES,
  });
}

export const dynamic = "force-dynamic";
