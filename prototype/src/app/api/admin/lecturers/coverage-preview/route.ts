import { NextRequest, NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { assignmentToData, isAssigned, readAssignment } from "@/lib/lecturer-assignment";
import { featuresForCurrentTenant } from "@/lib/tenant/features-server";
import { planLink, summarizePlans } from "@/lib/tutor-class-match";
import { LINK_STUDENT_SELECT, toLinkStudent } from "@/lib/tutor-link";

/**
 * How many active students a proposed coverage pattern would actually take in —
 * read before a save, not after.
 *
 * THIS USED TO REPORT THE WHOLE SCHOOL. It built the class filter and then
 * spread a tenant `OR` after it; the tenant `OR` replaced the filter's own
 * `OR` (which is where a tutor's teaching groups live), so the count was every
 * active student in the tenant no matter what the tutor was set to teach —
 * "This covers 454 students" for a single A1 evening group. The tenant clause
 * was redundant anyway (the data layer already scopes every query to the
 * tenant), so it is gone rather than fixed.
 *
 * Now it runs the SAME rule the roster and the linking panel run
 * (`fittingSeat`): exact branch, level, sitting, intake month and delivery
 * mode, including the online half of hybrid students. What it says is what the
 * tutor's roster will show. Read-only; it never touches the tutor row.
 */

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const assignment = readAssignment(assignmentToData(body ?? {}));
  const lecturerId = typeof body?.lecturerId === "string" ? body.lecturerId : "preview";

  if (!isAssigned(assignment)) {
    return NextResponse.json({ count: 0, levels: [], byLevel: {}, toLink: { primary: 0, coTutor: 0, other: 0 } });
  }

  const [onlineBranch, features, students] = await Promise.all([
    prisma.branch.findFirst({ where: { mode: "online" }, select: { id: true } }),
    featuresForCurrentTenant(),
    prisma.student.findMany({
      where: { status: "active", level: { in: assignment.levels } } as never,
      select: LINK_STUDENT_SELECT,
      take: 3000,
    }),
  ]);

  const fitting = students
    .map((student) => ({
      student,
      plan: planLink({
        lecturerId,
        assignment,
        student: toLinkStudent(student),
        onlineBranchId: onlineBranch?.id ?? null,
        sharedStudentsEnabled: features.roster.sharedStudents,
      }),
    }))
    .filter(({ plan }) => plan.action !== "no_fit");

  const byLevel: Record<string, number> = {};
  for (const { student } of fitting) byLevel[student.level] = (byLevel[student.level] ?? 0) + 1;

  const summary = summarizePlans(fitting.map(({ plan }) => plan));

  return NextResponse.json({
    count: fitting.length,
    levels: Object.keys(byLevel).sort(),
    byLevel,
    // What "link everyone" would do for the students this pattern covers.
    toLink: {
      primary: summary.add_primary,
      coTutor: summary.add_co_tutor,
      other: summary.shares_class + summary.conflict + summary.blocked,
    },
  });
}
