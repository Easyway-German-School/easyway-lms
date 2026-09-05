import { prisma } from "@/lib/prisma";
import { resolveBatchWindow } from "@/lib/batch";

/**
 * THE PER-LEVEL HISTORY — writers only.
 *
 * These are the only two functions that touch `StudentEnrolment` (see the
 * model's doc comment in schema.prisma for why it exists). Exactly one row
 * per student should ever sit at `outcome: "ongoing"` — every caller that
 * moves a student between levels, or ends their time in one without moving
 * them on, goes through `closeOpenEnrolment` before/instead of `openEnrolment`
 * rather than writing the table directly, so that invariant cannot drift.
 *
 * Both are best-effort by convention at the call site (see promotion.ts): a
 * failure here should never block the level change or the signup itself. A
 * missed row is repaired by scripts/backfill-student-enrolments.mjs.
 */

export type EnrolmentOutcome = "ongoing" | "completed" | "withdrawn" | "transferred";

export const ENROLMENT_OUTCOME_LABELS: Record<EnrolmentOutcome, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  withdrawn: "Withdrew",
  transferred: "Transferred",
};

export type OpenEnrolmentInput = {
  studentId: string;
  level: string;
  branchId?: string | null;
  tutorId?: string | null;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  /** Bare month name ("September"), same as the admission blob's `batch`. */
  batch?: string | null;
  /**
   * Anchors which calendar year the batch month resolves to — see
   * lib/batch.ts. Pass the student's actual registration date at signup, or
   * `now` at a later transition (promotion, re-enrolment), never left to
   * default silently to `now` when an earlier date is known.
   */
  registeredAt?: Date;
  tenantId?: string | null;
  startedAt?: Date | null;
  tuitionChargeId?: string | null;
  feeSnapshot?: number | null;
  now?: Date;
};

/**
 * Opens a new `ongoing` enrolment row. Called at signup, manual add, CSV
 * import (level #1) and at the end of a promotion (the level moved into).
 * Does NOT check for an already-open row first — callers that are moving a
 * student between levels call `closeOpenEnrolment` immediately before this,
 * and a fresh student has none to collide with.
 */
export async function openEnrolment(input: OpenEnrolmentInput) {
  const now = input.now ?? new Date();
  const window = resolveBatchWindow(input.batch ?? null, {
    registeredAt: input.registeredAt ?? now,
    now,
  });

  return prisma.studentEnrolment.create({
    data: {
      studentId: input.studentId,
      level: input.level,
      branchId: input.branchId ?? null,
      tutorId: input.tutorId ?? null,
      sessionSlot: input.sessionSlot,
      classType: input.classType,
      deliveryMode: input.deliveryMode,
      batchMonth: input.batch ?? null,
      batchYear: window?.year ?? null,
      startedAt: input.startedAt ?? null,
      outcome: "ongoing",
      tuitionChargeId: input.tuitionChargeId ?? null,
      feeSnapshot: input.feeSnapshot ?? null,
      tenantId: input.tenantId ?? null,
    },
  });
}

/**
 * Closes whichever enrolment is currently `ongoing` for this student, if any.
 * A student with no enrolment history yet (created before this table existed,
 * and not yet touched by the backfill) simply has nothing to close — that is
 * not an error, it is the gap the backfill script fills in.
 */
export async function closeOpenEnrolment(
  studentId: string,
  opts: { outcome: EnrolmentOutcome; outcomeNote?: string | null; now?: Date },
) {
  const now = opts.now ?? new Date();
  const open = await prisma.studentEnrolment.findFirst({
    where: { studentId, outcome: "ongoing", deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!open) return null;

  return prisma.studentEnrolment.update({
    where: { id: open.id },
    data: {
      endedAt: now,
      outcome: opts.outcome,
      ...(opts.outcomeNote !== undefined ? { outcomeNote: opts.outcomeNote } : {}),
    },
  });
}
