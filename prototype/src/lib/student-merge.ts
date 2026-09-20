/**
 * Folding one student record into another — the write sequence, on its own so
 * the ordering that keeps it safe can be tested.
 *
 * WHY THE ORDER IS THE WAY IT IS (this shipped broken once — 2026-09-19)
 *
 * The guarded Prisma client rewrites a `delete` on a soft-delete model into an
 * `update` — but it issues that update through the BASE client
 * (`createGuardExtension(base)` in prisma-guard.ts), not through the
 * transaction client the caller is holding. So `tx.student.delete(...)` inside
 * `prisma.$transaction(async tx => ...)` is NOT part of the transaction: it
 * commits the moment it runs, whatever happens to the rest.
 *
 * The first version of the merge put the moves AND the deletes in one
 * transaction. When that transaction timed out the moves rolled back — but the
 * soft-deletes had already landed, leaving the duplicate's student and login
 * hidden while its payment was still attached to it. A learner's money on a
 * record nobody could see.
 *
 * So now:
 *   1. INSIDE the transaction: only what a rollback can genuinely undo — move
 *      the money and its scaffolding, fill the keeper's blanks, stamp the
 *      `mergedInto` marker on the duplicate. If anything here fails, nothing
 *      has changed.
 *   2. AFTER the commit: the irreversible soft-deletes, one at a time,
 *      best-effort, student before login (never a live student with a dead
 *      login). The money is already safe by then. If hiding the STUDENT fails
 *      the duplicate stays visible (stamped `merged`) and the merge can simply
 *      be run again; if only the LOGIN fails the student is already hidden and
 *      the leftover login needs a person — either way nothing is lost and the
 *      outcome says so.
 *
 * `MergeDb` is the minimal shape needed so a test can drive it with a fake.
 */

export type MergeAdmission = Record<string, unknown>;

export type MergeParty = {
  id: string;
  studentCode: string | null;
  branchId: string | null;
  deliveryMode: string;
  admission: MergeAdmission;
  user: { id: string; email: string };
  profile: { phone: string | null; altPhone: string | null; whatsapp: string | null; photoUrl: string | null } | null;
};

type Rows<T> = Promise<T[]>;

/** The slice of a Prisma transaction client the moves need. */
export type MergeTx = {
  payment: { updateMany: (a: { where: { studentId: string }; data: { studentId: string } }) => Promise<{ count: number }> };
  invoice: { updateMany: (a: { where: { studentId: string }; data: { studentId: string } }) => Promise<{ count: number }> };
  paymentPlan: { updateMany: (a: { where: { studentId: string }; data: { studentId: string } }) => Promise<{ count: number }> };
  tuitionCharge: {
    findMany: (a: { where: { studentId: string }; select: { id?: true; level: true } }) => Rows<{ id: string; level: string }>;
    update: (a: { where: { id: string }; data: { studentId: string } }) => Promise<unknown>;
  };
  parentStudent: {
    findMany: (a: { where: { studentId: string }; select: { id?: true; parentId: true } }) => Rows<{ id: string; parentId: string }>;
    update: (a: { where: { id: string }; data: { studentId: string } }) => Promise<unknown>;
    delete: (a: { where: { id: string } }) => Promise<unknown>;
  };
  student: { update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
  studentProfile: { update: (a: { where: { studentId: string }; data: Record<string, unknown> }) => Promise<unknown> };
};

/** The client itself: a transaction, plus the three soft-deletes that must NOT be inside it. */
export type MergeDb = {
  $transaction: <T>(fn: (tx: MergeTx) => Promise<T>, options: { maxWait: number; timeout: number }) => Promise<T>;
  tuitionCharge: { delete: (a: { where: { id: string } }) => Promise<unknown> };
  student: { delete: (a: { where: { id: string } }) => Promise<unknown> };
  user: { delete: (a: { where: { id: string } }) => Promise<unknown> };
};

export type MergeOutcome = {
  payments: number;
  invoices: number;
  paymentPlans: number;
  chargesMoved: number;
  chargesDropped: number;
  guardiansMoved: number;
  /** Whether the duplicate's student AND login are now both hidden. False: see cleanupErrors. */
  retired: boolean;
  /** What went wrong after the commit, if anything. The money is safe regardless. */
  cleanupErrors: string[];
};

export async function mergeStudentRecords(
  db: MergeDb,
  keeper: MergeParty,
  absorb: MergeParty,
  nowIso: string = new Date().toISOString(),
): Promise<MergeOutcome> {
  const chargeIdsToDrop: string[] = [];

  // ---- 1. Everything a rollback can undo -----------------------------------
  const moved = await db.$transaction(
    async (tx) => {
      const payments = await tx.payment.updateMany({ where: { studentId: absorb.id }, data: { studentId: keeper.id } });
      const invoices = await tx.invoice.updateMany({ where: { studentId: absorb.id }, data: { studentId: keeper.id } });
      const plans = await tx.paymentPlan.updateMany({ where: { studentId: absorb.id }, data: { studentId: keeper.id } });

      // Tuition charges — one per (student, level). Move the levels the keeper
      // has no charge for; the duplicate's charge for a level the keeper already
      // carries is queued to be dropped AFTER the commit (a delete cannot be
      // rolled back), the office reconciles the figure later.
      const keeperLevels = new Set(
        (await tx.tuitionCharge.findMany({ where: { studentId: keeper.id }, select: { level: true } })).map((r) => r.level),
      );
      const absorbCharges = await tx.tuitionCharge.findMany({ where: { studentId: absorb.id }, select: { id: true, level: true } });
      let chargesMoved = 0;
      for (const charge of absorbCharges) {
        if (keeperLevels.has(charge.level)) {
          chargeIdsToDrop.push(charge.id);
        } else {
          await tx.tuitionCharge.update({ where: { id: charge.id }, data: { studentId: keeper.id } });
          keeperLevels.add(charge.level);
          chargesMoved += 1;
        }
      }

      // Guardian links — one per (parent, student).
      const keeperParents = new Set(
        (await tx.parentStudent.findMany({ where: { studentId: keeper.id }, select: { parentId: true } })).map((r) => r.parentId),
      );
      const absorbLinks = await tx.parentStudent.findMany({ where: { studentId: absorb.id }, select: { id: true, parentId: true } });
      let guardiansMoved = 0;
      for (const link of absorbLinks) {
        if (keeperParents.has(link.parentId)) {
          await tx.parentStudent.delete({ where: { id: link.id } });
        } else {
          await tx.parentStudent.update({ where: { id: link.id }, data: { studentId: keeper.id } });
          guardiansMoved += 1;
        }
      }

      // Fill the keeper's blanks from the duplicate — never overwrite.
      const keeperData: Record<string, unknown> = {};
      if (!keeper.branchId && absorb.branchId) keeperData.branchId = absorb.branchId;
      if (keeper.deliveryMode === "physical" && absorb.deliveryMode !== "physical") {
        keeperData.deliveryMode = absorb.deliveryMode;
      }
      const mergedAdmission: MergeAdmission = { ...absorb.admission, ...keeper.admission };
      if (!keeper.admission.batch && absorb.admission.batch) mergedAdmission.batch = absorb.admission.batch;
      if (!keeper.admission.phone && absorb.admission.phone) mergedAdmission.phone = absorb.admission.phone;
      const priorMerges = Array.isArray(keeper.admission.mergedFrom) ? keeper.admission.mergedFrom : [];
      mergedAdmission.mergedFrom = [
        ...priorMerges,
        { studentId: absorb.id, studentCode: absorb.studentCode ?? null, email: absorb.user.email, at: nowIso },
      ];
      keeperData.admission = mergedAdmission;
      await tx.student.update({ where: { id: keeper.id }, data: keeperData });

      // Profile: move it wholesale if the keeper has none, else fill blanks.
      if (!keeper.profile && absorb.profile) {
        await tx.studentProfile.update({ where: { studentId: absorb.id }, data: { studentId: keeper.id } });
      } else if (keeper.profile && absorb.profile) {
        const fill: Record<string, unknown> = {};
        for (const key of ["phone", "altPhone", "whatsapp", "photoUrl"] as const) {
          if (!keeper.profile[key] && absorb.profile[key]) fill[key] = absorb.profile[key];
        }
        if (Object.keys(fill).length > 0) {
          await tx.studentProfile.update({ where: { studentId: keeper.id }, data: fill });
        }
      }

      // Stamp the duplicate. This is an UPDATE, so it rolls back with the rest;
      // it is what makes an interrupted clean-up recognisable and re-runnable.
      await tx.student.update({
        where: { id: absorb.id },
        data: {
          status: "merged",
          admission: {
            ...absorb.admission,
            mergedInto: keeper.studentCode ?? keeper.id,
            mergedIntoId: keeper.id,
            mergedAt: nowIso,
          },
        },
      });

      return {
        payments: payments.count,
        invoices: invoices.count,
        paymentPlans: plans.count,
        chargesMoved,
        guardiansMoved,
      };
    },
    // Not the 5-second default: a guarded write does a before-image read and an
    // audit write around itself, and on a slow link that adds up.
    { maxWait: 15_000, timeout: 60_000 },
  );

  // ---- 2. The irreversible part, only now that the money is safe -------------
  const cleanupErrors: string[] = [];
  let chargesDropped = 0;
  for (const id of chargeIdsToDrop) {
    try {
      await db.tuitionCharge.delete({ where: { id } });
      chargesDropped += 1;
    } catch (error) {
      cleanupErrors.push(`charge ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let retired = false;
  try {
    await db.student.delete({ where: { id: absorb.id } });
    // Login only once the student is safely hidden — never a live student with
    // a dead login.
    try {
      await db.user.delete({ where: { id: absorb.user.id } });
      retired = true;
    } catch (error) {
      cleanupErrors.push(`login: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    cleanupErrors.push(`student: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { ...moved, chargesDropped, retired, cleanupErrors };
}
