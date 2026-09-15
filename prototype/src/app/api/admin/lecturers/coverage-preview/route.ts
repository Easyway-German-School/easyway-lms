import { NextRequest, NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { assignmentToData, isAssigned, readAssignment, studentWhereForAssignment } from "@/lib/lecturer-assignment";

/**
 * How many active students a proposed coverage pattern would sweep in — read
 * before a save, not after. A tutor's roster used to be pure query-time
 * pattern matching with no way to see the blast radius of a change before
 * committing it: an admin who left "levels" too broad found out only once a
 * tutor was already teaching (on paper) the entire school. This is a
 * read-only preview; it does not touch the tutor row.
 */

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const assignment = readAssignment(assignmentToData(body ?? {}));

  if (!isAssigned(assignment)) {
    return NextResponse.json({ count: 0, levels: [] });
  }

  const where = studentWhereForAssignment(assignment);
  const tenantId = gate.session.user.tenantId ?? null;

  const students = await prisma.student.findMany({
    where: {
      status: "active",
      ...(where ?? {}),
      ...(tenantId ? { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] } : {}),
    },
    select: { level: true },
    take: 2000,
  });

  return NextResponse.json({
    count: students.length,
    levels: [...new Set(students.map((student) => student.level))].sort(),
  });
}
