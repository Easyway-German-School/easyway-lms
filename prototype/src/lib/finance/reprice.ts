import { prisma } from "@/lib/prisma";
import { buildLedger, type LedgerChargeInput } from "@/lib/finance/ledger";
import { isTravelPackagePathway, receivedPaymentFilter, tuitionFeeFor } from "@/lib/payment";

/**
 * CHARGES THAT NO LONGER MATCH THE PRICE LIST — find them, and correct the ones
 * an admin picks.
 *
 * A `TuitionCharge` freezes its fee the moment it is raised, on purpose: a price
 * change must never silently move a bill a student already agreed to (see the
 * model comment in schema.prisma). The flip side is that when the price list is
 * WRONG — private A1 quoted at ₦350,000 when the school charges ₦300,000 — every
 * student charged at the wrong figure keeps it, and the portal lock reads the
 * charge, not the price list, so they stay locked out of a deposit they have
 * already paid. Editing the price list alone fixes nobody who is already
 * enrolled.
 *
 * This is the explicit, admin-driven way to fix them. Nothing here runs on its
 * own and nothing is repriced without a person ticking the row: raising a
 * price (B1 private ₦350k → ₦360k) would otherwise quietly add ₦10,000 to what
 * every current student owes.
 *
 * WHAT IS ELIGIBLE — deliberately narrow:
 *   - the charge is still OPEN (the student owes something on it). A settled
 *     charge is history; reopening it would invent a debt.
 *   - no waiver on it. A scholarship is a negotiated figure; repricing the
 *     gross would change what the student actually pays in a way nobody chose.
 *   - not `legacyArrears` (a pre-ledger level, priced at whatever it was then)
 *     and not origin `admin` (a figure a person typed by hand).
 *   - not a Travel Package student — that has its own reconcile
 *     (src/lib/travel-package.ts).
 * The expected amount comes from the price book and the charge's OWN snapshot
 * of class type and branch — what the student was billed as, not what their
 * record says today.
 *
 * The server recomputes every target amount itself. The request carries only
 * charge ids, never a price.
 */

export type RepriceRow = {
  chargeId: string;
  studentId: string;
  studentName: string;
  studentCode: string | null;
  level: string;
  classType: string;
  branchName: string | null;
  origin: string;
  /** What the charge says now. */
  currentAmount: number;
  /** What the price book says it should be. */
  newAmount: number;
  /** Payments FIFO-allocated to this charge so far. */
  paid: number;
  /** What the student would still owe on it after the change (0 if they overpaid). */
  owedAfter: number;
  /** Paid more than the corrected price — the office may owe a refund or credit. */
  overpaidBy: number;
};

/** Everything except a person-typed figure or a pre-ledger level can be repriced. */
const INELIGIBLE_ORIGINS = ["admin"];

type Candidate = {
  chargeId: string;
  studentId: string;
  note: string | null;
  row: Omit<RepriceRow, "paid" | "owedAfter" | "overpaidBy">;
};

async function loadCandidates(onlyIds?: string[]): Promise<Candidate[]> {
  const charges = await prisma.tuitionCharge.findMany({
    where: {
      deletedAt: null,
      legacyArrears: false,
      waivedAmount: 0,
      origin: { notIn: INELIGIBLE_ORIGINS },
      ...(onlyIds ? { id: { in: onlyIds } } : {}),
    },
    select: {
      id: true,
      studentId: true,
      level: true,
      amount: true,
      classType: true,
      branchName: true,
      origin: true,
      note: true,
      student: {
        select: { pathway: true, studentCode: true, user: { select: { name: true, email: true } } },
      },
    },
  });

  const out: Candidate[] = [];
  for (const charge of charges) {
    if (isTravelPackagePathway(charge.student?.pathway)) continue;
    // Read AFTER the query above — that query is what refreshes the price book.
    // `pathway` must be passed through: an Exam Preparatory charge is priced
    // off its own ladder (see EXAM_PREPARATORY_PATHWAY in payment.ts), and
    // without it here every such student would compare against the ordinary
    // group/private price and get "corrected" onto the wrong figure.
    const newAmount = tuitionFeeFor({
      level: charge.level,
      branch: charge.branchName,
      classType: charge.classType,
      pathway: charge.student?.pathway,
    });
    if (newAmount === charge.amount) continue;
    out.push({
      chargeId: charge.id,
      studentId: charge.studentId,
      note: charge.note,
      row: {
        chargeId: charge.id,
        studentId: charge.studentId,
        studentName: charge.student?.user?.name || charge.student?.user?.email || "Unnamed student",
        studentCode: charge.student?.studentCode ?? null,
        level: charge.level,
        classType: charge.classType,
        branchName: charge.branchName,
        origin: charge.origin,
        currentAmount: charge.amount,
        newAmount,
      },
    });
  }
  return out;
}

/** Which of the candidates still owe something on the charge, with the money figures. */
async function withOpenBalances(candidates: Candidate[]): Promise<Array<Candidate & { detail: RepriceRow }>> {
  if (!candidates.length) return [];
  const studentIds = [...new Set(candidates.map((c) => c.studentId))];

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      tuitionCharges: {
        where: { deletedAt: null },
        select: {
          id: true,
          level: true,
          amount: true,
          waivedAmount: true,
          legacyArrears: true,
          createdAt: true,
          settledAt: true,
        },
      },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
    },
  });

  const byStudent = new Map(students.map((s) => [s.id, s]));
  const result: Array<Candidate & { detail: RepriceRow }> = [];

  for (const candidate of candidates) {
    const student = byStudent.get(candidate.studentId);
    if (!student) continue;
    const totalReceived = student.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const ledger = buildLedger(student.tuitionCharges as LedgerChargeInput[], totalReceived);
    const line = ledger.lines.find((l) => l.chargeId === candidate.chargeId);
    // Settled (or gone) — history, not a bill to reopen.
    if (!line || line.outstanding <= 0) continue;

    const newAmount = candidate.row.newAmount;
    result.push({
      ...candidate,
      detail: {
        ...candidate.row,
        paid: line.allocated,
        owedAfter: Math.max(0, newAmount - line.allocated),
        overpaidBy: Math.max(0, line.allocated - newAmount),
      },
    });
  }
  return result;
}

/** Every open charge whose amount differs from the price list, biggest drops first. */
export async function findChargesOutOfStep(limit = 300): Promise<{ rows: RepriceRow[]; total: number }> {
  const open = await withOpenBalances(await loadCandidates());
  const rows = open
    .map((c) => c.detail)
    .sort((a, b) => a.newAmount - a.currentAmount - (b.newAmount - b.currentAmount) || a.studentName.localeCompare(b.studentName));
  return { rows: rows.slice(0, limit), total: rows.length };
}

export type RepriceResult = {
  updated: Array<{ chargeId: string; studentName: string; from: number; to: number }>;
  /** Ids that were no longer eligible when applied (already fixed, settled, waived…). */
  skipped: string[];
};

/**
 * Correct the chosen charges to the price list. Re-derives eligibility and the
 * new amount server-side for each id, so a stale page or a hand-built request
 * can only ever land on the current, correct figure — or be skipped.
 *
 * Each update goes through the guarded client, so it leaves a before/after
 * audit row (TuitionCharge is fully audited); `note` records why.
 */
export async function applyReprice(chargeIds: string[], now: Date = new Date()): Promise<RepriceResult> {
  const ids = [...new Set(chargeIds.filter((id) => typeof id === "string" && id))];
  const eligible = await withOpenBalances(await loadCandidates(ids));
  const eligibleIds = new Set(eligible.map((c) => c.chargeId));

  const stamp = now.toISOString().slice(0, 10);
  const updated: RepriceResult["updated"] = [];

  for (const candidate of eligible) {
    const { currentAmount, newAmount, studentName } = candidate.detail;
    const line = `Re-priced ₦${currentAmount.toLocaleString("en-NG")} → ₦${newAmount.toLocaleString("en-NG")} on ${stamp} to match the price list`;
    await prisma.tuitionCharge.update({
      where: { id: candidate.chargeId },
      data: { amount: newAmount, note: candidate.note ? `${candidate.note} · ${line}` : line },
    });
    updated.push({ chargeId: candidate.chargeId, studentName, from: currentAmount, to: newAmount });
  }

  return { updated, skipped: ids.filter((id) => !eligibleIds.has(id)) };
}
