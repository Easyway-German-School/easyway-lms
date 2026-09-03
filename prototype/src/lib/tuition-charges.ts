import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { tuitionFeeFor } from "@/lib/payment";

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
      branch: { select: { name: true } },
    },
  });
  if (!student) return null;

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
