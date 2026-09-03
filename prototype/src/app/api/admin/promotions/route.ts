import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { findPromotionCandidates, promoteStudents, SESSION_MONTHS } from "@/lib/promotion";
import { letterFor, PASS_MARK, weightedCourseworkAverage } from "@/lib/grading";
import { receivedPaymentFilter } from "@/lib/payment";
import { buildLedger } from "@/lib/finance/ledger";

export const dynamic = "force-dynamic";

async function requireStudentsAdmin() {
  return requireCapability("students");
}

/** GET — students whose session has ended but who are still on the same level. */
export async function GET(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const candidates = await findPromotionCandidates({
      branchId: req.nextUrl.searchParams.get("branchId"),
      level: req.nextUrl.searchParams.get("level"),
    });

    // Coursework standing, so the office does not promote a student who has not
    // passed the level they are leaving. Newest mark per skill, weighted — the
    // same figure the results page and the gradebook show.
    const ids = candidates.map((candidate) => candidate.studentId);
    const grades = ids.length
      ? await prisma.grade.findMany({
          where: { studentId: { in: ids }, examId: null },
          orderBy: { createdAt: "desc" },
          select: { studentId: true, type: true, score: true },
        })
      : [];
    const latestByStudent = new Map<string, Map<string, number>>();
    for (const grade of grades) {
      let marks = latestByStudent.get(grade.studentId);
      if (!marks) {
        marks = new Map();
        latestByStudent.set(grade.studentId, marks);
      }
      if (!marks.has(grade.type)) marks.set(grade.type, grade.score);
    }

    // Tuition ledger per candidate, so the office sees "clears fees" vs "owes
    // ₦X on A2" before it promotes — and knows which rows will need an override.
    const charges = ids.length
      ? await prisma.tuitionCharge.findMany({
          where: { studentId: { in: ids }, deletedAt: null },
          select: { studentId: true, id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
        })
      : [];
    const payments = ids.length
      ? await prisma.payment.findMany({
          where: { studentId: { in: ids }, ...receivedPaymentFilter() },
          select: { studentId: true, amount: true },
        })
      : [];
    const chargesByStudent = new Map<string, typeof charges>();
    for (const charge of charges) {
      const list = chargesByStudent.get(charge.studentId) ?? [];
      list.push(charge);
      chargesByStudent.set(charge.studentId, list);
    }
    const paidByStudent = new Map<string, number>();
    for (const payment of payments) {
      paidByStudent.set(payment.studentId, (paidByStudent.get(payment.studentId) ?? 0) + (payment.amount || 0));
    }

    const enriched = candidates.map((candidate) => {
      const marks = latestByStudent.get(candidate.studentId);
      const courseworkAverage = weightedCourseworkAverage(
        marks ? [...marks.entries()].map(([type, score]) => ({ type, score })) : [],
      );
      const ledger = buildLedger(
        chargesByStudent.get(candidate.studentId) ?? [],
        paidByStudent.get(candidate.studentId) ?? 0,
      );
      // What blocks a promotion: owed on a level the student has already been in
      // (not the level they'd move into), legacy arrears excluded.
      const nextLevel = candidate.nextLevel;
      const priorOwed = ledger.lines
        .filter((line) => line.outstanding > 0 && !line.legacyArrears && line.level !== nextLevel)
        .reduce((sum, line) => sum + line.outstanding, 0);
      return {
        ...candidate,
        courseworkAverage,
        courseworkGrade: courseworkAverage === null ? null : letterFor(courseworkAverage),
        belowPassMark: courseworkAverage !== null && courseworkAverage < PASS_MARK,
        ledgerOutstanding: ledger.lifetimeOutstanding,
        priorLevelOwed: priorOwed,
        legacyArrears: ledger.legacyOutstanding,
        needsFeeOverride: priorOwed > 0,
        openCharges: ledger.lines
          .filter((line) => line.outstanding > 0)
          .map((line) => ({ level: line.level, outstanding: line.outstanding, legacyArrears: line.legacyArrears })),
      };
    });

    return NextResponse.json({ candidates: enriched, sessionMonths: SESSION_MONTHS, passMark: PASS_MARK });
  } catch (error) {
    console.error("Promotion candidates GET failed:", error);
    return NextResponse.json({ error: "Unable to build the promotion list" }, { status: 500 });
  }
}

/**
 * POST — move the given students up a level.
 *
 * A student who still owes on a level they have already been in is skipped
 * (see promoteStudents) and comes back in `result.skipped` with the figure.
 * The caller can retry with `override: { reason }` to push those through — but
 * only a super admin may, and every override is written to the audit trail.
 */
export async function POST(req: NextRequest) {
  const gate = await requireStudentsAdmin();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const ids = Array.isArray(body?.studentIds) ? body.studentIds.filter((v: unknown) => typeof v === "string") : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
    }

    let override: { by: string; reason: string } | undefined;
    const reason = typeof body?.override?.reason === "string" ? body.override.reason.trim() : "";
    if (body?.override) {
      if (gate.admin.adminRole !== "super") {
        return NextResponse.json(
          { error: "Only a super admin can promote a student who still owes tuition on an earlier level." },
          { status: 403 },
        );
      }
      if (reason.length < 3) {
        return NextResponse.json(
          { error: "An override needs a reason for the audit trail." },
          { status: 400 },
        );
      }
      override = { by: gate.admin.email, reason };
    }

    const result = await promoteStudents(ids, { override });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Promotion POST failed:", error);
    return NextResponse.json({ error: "Unable to move these students" }, { status: 500 });
  }
}
