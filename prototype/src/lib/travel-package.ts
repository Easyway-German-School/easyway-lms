import { prisma } from "@/lib/prisma";
import { LEVELS } from "@/lib/levels";
import {
  isReceivedPayment,
  isRegistrationFeePayment,
  isTravelPackagePathway,
  tuitionFeeFor,
  TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
  TRAVEL_PACKAGE_PATHWAY,
  TRAVEL_PACKAGE_PRICE,
} from "@/lib/payment";

/**
 * PUTTING A TRAVEL PACKAGE STUDENT'S LEDGER STRAIGHT.
 *
 * Travel Package is a flat ₦980,000 that REPLACES the per-level tuition ladder
 * (see the block comment on TRAVEL_PACKAGE_PRICE in src/lib/payment.ts). Every
 * fee surface in the app already knows this — but only through the student's
 * `pathway` column, and only if the ledger carries the right charge.
 *
 * Two ways a Travel Package student ends up mis-priced anyway:
 *
 *   1. Onboarded on the ordinary "Add student" form with the pathway left on
 *      its default ("Language training"), then a large first payment recorded.
 *      The system priced them at the A1 ladder fee (~₦150,000), the payment
 *      cleared it with change, and every screen — their own portal included —
 *      called them "paid in full".
 *
 *   2. Their one `TuitionCharge` was raised at the per-level price BEFORE the
 *      pathway was set (a failed charge-create on add, an `import`/`backfill`
 *      amount, or the pathway switched from an admin edit after the fact).
 *      `ensureChargeForLevel` never rewrites a charge, so it stays wrong.
 *
 * This reconciles both. It is idempotent: run it on an already-correct student
 * and nothing changes. It NEVER touches `Payment` rows — the money that came in
 * is the money that came in; only the debit side is corrected.
 */

export type TravelPackageReconcileResult = {
  studentId: string;
  /** The pathway was moved onto Travel Package by this call. */
  pathwaySet: boolean;
  /** A charge row was created or its amount corrected. */
  chargeFixed: boolean;
  /** Extra charges (from earlier levels) folded away, count. */
  chargesRetired: number;
  /** Received, non-registration payments — unchanged by this call. */
  paid: number;
  /** ₦980,000 − paid, floored at 0. */
  owed: number;
  /** Was the account reading as fully settled before this ran? */
  wasFullPaidBefore: boolean;
  /** Is it fully settled now (paid ≥ ₦980,000)? */
  fullPaidAfter: boolean;
  /** Has the ₦200,000 minimum first payment been met? */
  floorMet: boolean;
  packagePrice: number;
  minFirstPayment: number;
};

function ladderIndex(level: string): number {
  const i = (LEVELS as readonly string[]).indexOf(String(level ?? "").trim().toUpperCase());
  return i === -1 ? LEVELS.length : i;
}

/**
 * @param setPathway  when true, also move the student ONTO the Travel Package
 *   pathway if they are not already on it. The caller that is itself writing
 *   `pathway` in the same request passes false and lets its own write stand.
 */
export async function reconcileTravelPackageStudent({
  studentId,
  setPathway = false,
  now = new Date(),
}: {
  studentId: string;
  setPathway?: boolean;
  now?: Date;
}): Promise<TravelPackageReconcileResult | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      level: true,
      pathway: true,
      classType: true,
      tenantId: true,
      branch: { select: { name: true } },
      tuitionCharges: {
        where: { deletedAt: null },
        select: { id: true, level: true, amount: true, waivedAmount: true, createdAt: true, note: true },
      },
      payments: {
        where: { deletedAt: null },
        select: { amount: true, status: true, description: true },
      },
    },
  });
  if (!student) return null;

  const paid = student.payments
    .filter(
      (p) =>
        (p.status == null || isReceivedPayment(p.status)) && !isRegistrationFeePayment(p.description),
    )
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  // The fee the rest of the app is quoting for this student RIGHT NOW — i.e.
  // before any pathway change this call is about to make.
  const feeBefore = tuitionFeeFor({
    level: student.level,
    branch: student.branch?.name ?? null,
    classType: student.classType,
    pathway: student.pathway,
  });
  const wasFullPaidBefore = paid >= feeBefore;

  let pathwaySet = false;
  if (setPathway && !isTravelPackagePathway(student.pathway)) {
    await prisma.student.update({
      where: { id: student.id },
      data: { pathway: TRAVEL_PACKAGE_PATHWAY },
    });
    pathwaySet = true;
  }

  // One flat charge for the whole programme. Keep the oldest existing charge as
  // the survivor, price it at ₦980,000, and fold every other level's charge
  // away — a Travel Package student never owes A1/A2/... on top.
  const charges = [...student.tuitionCharges].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (at !== bt) return at - bt;
    return ladderIndex(a.level) - ladderIndex(b.level);
  });

  let chargeFixed = false;
  let chargesRetired = 0;
  const stamp = now.toISOString().slice(0, 10);

  if (charges.length === 0) {
    await prisma.tuitionCharge.create({
      data: {
        studentId: student.id,
        level: String(student.level ?? "A1").trim().toUpperCase() || "A1",
        amount: TRAVEL_PACKAGE_PRICE,
        classType: student.classType ?? "group",
        branchName: student.branch?.name ?? null,
        origin: "admin",
        note: `Travel Package flat ₦${TRAVEL_PACKAGE_PRICE.toLocaleString("en-NG")} — reconciled ${stamp}`,
        ...(student.tenantId ? { tenantId: student.tenantId } : {}),
      },
    });
    chargeFixed = true;
  } else {
    const survivor = charges[0];
    const net = Math.max(0, survivor.amount - (survivor.waivedAmount ?? 0));
    if (net !== TRAVEL_PACKAGE_PRICE) {
      await prisma.tuitionCharge.update({
        where: { id: survivor.id },
        data: {
          // Set the gross so that gross − existing waiver lands on ₦980,000;
          // a genuine negotiated write-off the office entered is preserved.
          amount: TRAVEL_PACKAGE_PRICE + (survivor.waivedAmount ?? 0),
          note: `${survivor.note ? `${survivor.note} · ` : ""}Reconciled to Travel Package flat ₦${TRAVEL_PACKAGE_PRICE.toLocaleString("en-NG")} on ${stamp}`,
        },
      });
      chargeFixed = true;
    }

    for (const extra of charges.slice(1)) {
      // The guard turns this into a soft delete (deletedAt set) — see
      // src/lib/prisma-guard.ts. The row stays auditable and restorable.
      await prisma.tuitionCharge.delete({ where: { id: extra.id } });
      chargesRetired += 1;
    }
  }

  const owed = Math.max(0, TRAVEL_PACKAGE_PRICE - paid);

  return {
    studentId: student.id,
    pathwaySet,
    chargeFixed,
    chargesRetired,
    paid,
    owed,
    wasFullPaidBefore,
    fullPaidAfter: paid >= TRAVEL_PACKAGE_PRICE,
    floorMet: paid >= TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
    packagePrice: TRAVEL_PACKAGE_PRICE,
    minFirstPayment: TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
  };
}
