import { unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";

/**
 * Re-using the email address of a student the office deleted.
 *
 * `User` is a soft-delete model (src/lib/prisma-guard.ts): deleting a student
 * turns into `deletedAt = now()` and the row — with its email — stays in the
 * table. The unique index on `User.email` still holds that address, so adding
 * the same person back used to be impossible two ways over:
 *
 *   1. the pre-check `user.findUnique({ where: { email }, select: { id: true } })`
 *      still returned the tombstone's id (the guard only hides a soft-deleted
 *      row from `findUnique` when `deletedAt` is in the selection), so the add
 *      form reported "that email already has an account";
 *   2. past that check, `user.create({ data: { email } })` hit the email unique
 *      index against the tombstone and threw P2002.
 *
 * The fix is to notice the tombstone and revive it in place rather than trying
 * to create a second row. Callers ask {@link lookupEmailAccount} what is
 * holding the address, and — for a deleted student — call
 * {@link reviveDeletedAccount} and then UPDATE that same `User`/`Student` into
 * the new details instead of creating.
 *
 * Old related rows (payments, grades, enrolments) stay soft-deleted and out of
 * sight; the original deletion's audit entry can still put any of them back.
 */

export type EmailAccountState =
  | { kind: "free" }
  | { kind: "live"; userId: string }
  | { kind: "deleted"; userId: string; studentId: string | null };

/**
 * What, if anything, currently holds this email address — asked on the
 * unguarded client so a soft-deleted tombstone is visible rather than hidden.
 *
 * A soft-deleted account is only reported as `deleted` (i.e. reclaimable) when
 * it was a plain student login. A deleted staff account that happened to share
 * the address is reported as `live` so the caller still refuses the add.
 */
export async function lookupEmailAccount(email: string): Promise<EmailAccountState> {
  const normalized = email.trim().toLowerCase();
  const user = await unguardedPrisma.user.findUnique({
    where: { email: normalized },
    select: {
      id: true,
      role: true,
      adminRole: true,
      deletedAt: true,
      student: { select: { id: true } },
    },
  });

  if (!user) return { kind: "free" };
  if (!user.deletedAt) return { kind: "live", userId: user.id };

  const wasPlainStudent = user.role === "STUDENT" && user.adminRole == null;
  if (!wasPlainStudent) return { kind: "live", userId: user.id };

  return { kind: "deleted", userId: user.id, studentId: user.student?.id ?? null };
}

/**
 * Clear `deletedAt` on a soft-deleted account's `User` and its `Student` so the
 * row can be updated into a new enrolment. No other field is touched here — the
 * caller owns that. No-op if the account is not actually soft-deleted.
 */
export async function reviveDeletedAccount(userId: string): Promise<void> {
  const user = await unguardedPrisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, deletedAt: true, student: { select: { id: true } } },
  });
  if (!user || !user.deletedAt) return;

  // The unguarded client on purpose: the guarded one filters out exactly the
  // rows this is trying to reach, and would re-audit the update as a delete.
  await unguardedPrisma.user.update({ where: { id: userId }, data: { deletedAt: null } });
  if (user.student) {
    await unguardedPrisma.student.update({
      where: { id: user.student.id },
      data: { deletedAt: null },
    });
  }

  await writeAudit(unguardedPrisma, {
    action: "restore",
    model: "User",
    recordId: userId,
    affectedCount: 1,
    severity: "notice",
    summary: `Revived soft-deleted account ${user.email} for re-enrolment`,
  });
}
