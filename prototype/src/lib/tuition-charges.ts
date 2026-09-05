import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isTravelPackagePathway, receivedPaymentFilter, tuitionFeeFor } from "@/lib/payment";
import { buildLedger, type Ledger } from "@/lib/finance/ledger";

/**
 * Raising `TuitionCharge` rows — the debit side of the per-level ledger.
 *
 * Every level a student enters should leave exactly one charge, with the fee
 * frozen at that moment. This module is the ONLY place app code creates one, so
 * the "one per level, priced off the branch, tenant-stamped" rules live in one
 * spot. Reads and reconciliation are src/lib/finance/ledger.ts; this is writes.
 *
 * Callers (all request- or webhook-scoped, so the tenant extension stamps
 * `tenantId` itself — we still pass it for the unscoped cron/webhook paths and
 * so the row is self-consistent):
 *   - signup / admin "create student"      origin "signup"
 *   - promoteStudents                      origin "promotion"
 *   - the "Continue to X" checkout         origin "next_level_payment"
 *   - admin manual adjustment              origin "admin"
 *   - admin CSV import                     origin "import"
 * The one-time cutover is scripts/backfill-tuition-charges.mjs (origin
 * "backfill"), which talks to a raw PrismaClient and sets tenantId by hand.
 */

export type ChargeOrigin =
  | "signup"
  | "promotion"
  | "next_level_payment"
  | "admin"
  | "import"
  | "backfill";

export type EnsureChargeInput = {
  studentId: string;
  /** Level the charge is for, e.g. "A1". Normalised to upper-case. */
  level: string;
  origin: ChargeOrigin;
  /** Pre-ledger level a student had already passed — see the model comment. */
  legacyArrears?: boolean;
  note?: string;
  /**
   * Override the frozen amount. Only the backfill/import paths should need this
   * (a historical price); everything else prices off the student's branch now.
   */
  amountOverride?: number;
  now?: Date;
};

export type EnsureChargeResult = {
  created: boolean;
  chargeId: string;
  level: string;
  amount: number;
};

/**
 * Create the charge for `level` if the student does not already have one.
 *
 * Idempotent via the `(studentId, level)` unique index: a repeated call — a
 * retried webhook, a double-submitted admin form — is a no-op that returns the
 * existing row. Never rewrites an existing charge (its amount is frozen).
 */
export async function ensureChargeForLevel(input: EnsureChargeInput): Promise<EnsureChargeResult | null> {
  const level = String(input.level ?? "").trim().toUpperCase();
  if (!level) return null;

  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: {
      id: true,
      classType: true,
      tenantId: true,
      pathway: true,
      branch: { select: { name: true } },
    },
  });
  if (!student) return null;

  // Travel Package is one flat charge for the whole program, not one per
  // level — since tuitionFeeFor now prices every level the same ₦980,000 for
  // this pathway, the normal per-level uniqueness check below would raise a
  // fresh ₦980,000 charge at every promotion. Look for ANY existing charge
  // first, regardless of level, and stop there if one is already on file.
  if (isTravelPackagePathway(student.pathway)) {
    const existingAny = await prisma.tuitionCharge.findFirst({
      where: { studentId: student.id, deletedAt: null },
      select: { id: true, level: true, amount: true },
    });
    if (existingAny) {
      return { created: false, chargeId: existingAny.id, level: existingAny.level, amount: existingAny.amount };
    }
  }

  const existing = await prisma.tuitionCharge.findUnique({
    where: { studentId_level: { studentId: student.id, level } },
    select: { id: true, amount: true },
  });
  if (existing) {
    return { created: false, chargeId: existing.id, level, amount: existing.amount };
  }

  const amount =
    typeof input.amountOverride === "number" && input.amountOverride >= 0
      ? Math.round(input.amountOverride)
      : tuitionFeeFor({
          level,
          branch: student.branch?.name ?? null,
          classType: student.classType,
          pathway: student.pathway,
        });

  const data: Prisma.TuitionChargeUncheckedCreateInput = {
    studentId: student.id,
    level,
    amount,
    classType: student.classType ?? "group",
    branchName: student.branch?.name ?? null,
    origin: input.origin,
    legacyArrears: Boolean(input.legacyArrears),
    note: input.note ?? null,
    ...(student.tenantId ? { tenantId: student.tenantId } : {}),
  };

  try {
    const charge = await prisma.tuitionCharge.create({ data, select: { id: true } });
    return { created: true, chargeId: charge.id, level, amount };
  } catch (error) {
    // A racing caller won the unique index between our check and our create.
    // Re-read and treat it as "already there" rather than throwing into a
    // payment or promotion path.
    const raced = await prisma.tuitionCharge.findUnique({
      where: { studentId_level: { studentId: student.id, level } },
      select: { id: true, amount: true },
    });
    if (raced) return { created: false, chargeId: raced.id, level, amount: raced.amount };
    console.error("ensureChargeForLevel: create failed", { studentId: input.studentId, level, error });
    return null;
  }
}

/**
 * Load one student's live ledger straight from the database — their open
 * charges reconciled FIFO against every received payment. The shared read used
 * by the promotion gate and the next-level checkout.
 */
export async function loadStudentLedger(studentId: string, now: Date = new Date()): Promise<Ledger> {
  const [charges, payments] = await Promise.all([
    prisma.tuitionCharge.findMany({
      where: { studentId, deletedAt: null },
      select: {
        id: true,
        level: true,
        amount: true,
        waivedAmount: true,
        legacyArrears: true,
        createdAt: true,
        settledAt: true,
      },
    }),
    prisma.payment.findMany({
      where: { studentId, ...receivedPaymentFilter() },
      select: { amount: true },
    }),
  ]);

  const paid = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
  return buildLedger(charges, paid, now);
}
