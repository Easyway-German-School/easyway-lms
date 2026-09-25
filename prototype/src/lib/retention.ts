/**
 * Retention — what happens to a class recording as it ages.
 *
 * ---------------------------------------------------------------------------
 * THE POLICY, AND WHY IT CHANGED
 * ---------------------------------------------------------------------------
 * A class recording is there so THIS week's cohort can catch up on THIS week's
 * lesson. That need has a short life, so the STUDENT's view of a recording is
 * capped: 14 days after the class, the video drops off their shelf. This is a
 * read-side filter — `ClassRecording.studentExpiresAt`, checked in
 * `/api/student/videos` and the notes access helper. Nothing is deleted, and
 * the AI class notes plus anything the student wrote survive in their "My
 * Notes" hub. Only the video itself goes.
 *
 * The assigned tutor and admin keep EVERY recording, forever. There is no
 * automatic age-based deletion of the files any more — an earlier version of
 * this module reclaimed the bucket object after a week, which also destroyed
 * staff access. Deleting a term's teaching is now a deliberate, manual act:
 * `applyRetention({ olderThanDays })` still exists for an admin who explicitly
 * asks to purge old files, but nothing schedules it.
 *
 * `keepForever` still matters: it also pins the video on the STUDENT's shelf
 * past the 14-day window (a landmark lesson, an exam briefing).
 *
 * `planRetention()` is separate from `applyRetention()` on purpose: you can
 * always ask what a manual purge *would* do, and the answer costs nothing.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteRecordingObject } from "@/lib/recording";

export const RETENTION = {
  /**
   * How long a completed recording stays on a STUDENT's shelf, measured from
   * the class date. Enforced as a query filter, never by deletion.
   */
  studentWindowDays: 14,
  /**
   * A GROUP recording shorter than this is a false start, a connection test,
   * or a class that ended almost as soon as it began — not a lesson anybody
   * needs to rewatch. Unlike the age-based policy above, this one deletes:
   * see `isTooShortToKeep` and its use in class-recorder.ts's
   * `finaliseRecording`, which discards a recording this short the moment it
   * finishes processing, before it ever becomes a Material row a portal
   * could show. A PRIVATE one-to-one session is exempt regardless of length
   * — a short private lesson is still a real, paid lesson a student may
   * want proof of, not a false start.
   */
  minWorthKeepingSeconds: 40 * 60,
  /**
   * How long a held short recording waits before `short-recording-purge`
   * (the daily cron, see src/app/api/cron/tick/route.ts) actually deletes
   * it. The recording is still never shown to anyone during this window —
   * it just is not yet gone for good, so a class that genuinely ran close
   * to 40 minutes, or one a dropped connection cut short, sits in the
   * Materials > Activity preview list for a couple of days before it is
   * destroyed rather than the instant it finishes recording. The window
   * applies whether the delete is triggered by the cron or by an admin's own
   * "Delete short recordings" button — nothing can jump ahead of it, which is
   * the whole point of having it.
   */
  shortRecordingGraceHours: 48,
} as const;

/** True for a GROUP recording too short to be worth keeping. Never for a private one. */
export function isTooShortToKeep(durationSeconds: number | null, isPrivate: boolean): boolean {
  if (isPrivate) return false;
  return durationSeconds != null && durationSeconds < RETENTION.minWorthKeepingSeconds;
}

/** Re-exported flat for callers that just want the number. */
export const STUDENT_RECORDING_WINDOW_DAYS = RETENTION.studentWindowDays;

/**
 * The `studentExpiresAt` stamp `class-recorder.ts` writes when a recording is
 * published, and the value the migration backfills onto old rows.
 */
export function studentExpiryFrom(recordedAt: Date): Date {
  return new Date(recordedAt.getTime() + STUDENT_RECORDING_WINDOW_DAYS * 86_400_000);
}

/**
 * The ONE Material filter for "has not aged off students' shelves". Every
 * student-facing query that can return a recording must include it — the shelf
 * (`/api/student/videos`), the materials list, catch-up and recommendations all
 * did their own thing before, and three of them had no expiry at all, so a
 * recording past its 14 days kept surfacing there.
 *
 * A lesson video or document has no `recording` relation, so `NOT { recording:
 * { is: … } }` leaves it untouched. Staff never use this.
 */
export function notExpiredForStudents(now: Date = new Date()): Prisma.MaterialWhereInput {
  return { NOT: { recording: { is: { keepForever: false, studentExpiresAt: { lte: now } } } } };
}

/** True when this recording's video should no longer be shown to students. */
export function isExpiredForStudents(
  recording: { studentExpiresAt?: Date | null; keepForever?: boolean | null },
  now: Date = new Date(),
): boolean {
  if (recording.keepForever) return false;
  return Boolean(recording.studentExpiresAt && recording.studentExpiresAt.getTime() <= now.getTime());
}

export type RetentionDecision = "keep" | "reclaim";

export type RetentionVerdict = {
  recordingId: string;
  materialId: string | null;
  title: string;
  recordedAt: Date;
  ageDays: number;
  sizeBytes: number;
  variant: string;
  /** Whether the student-side 14-day window has already passed for this one. */
  expiredForStudents: boolean;
  decision: RetentionDecision;
  /** Plain English, because this list is read by a person deciding to trust it. */
  reason: string;
};

export type RetentionPlan = {
  verdicts: RetentionVerdict[];
  reclaimable: number;
  bytesReclaimable: number;
};

function days(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * What retention would do. Reads only — never deletes.
 *
 * With no `olderThanDays`, every recording is `keep`: staff retention is
 * forever and there is nothing to reclaim. Pass `olderThanDays` to model a
 * manual admin purge of files past a certain age.
 */
export async function planRetention(
  opts: { olderThanDays?: number; now?: Date } = {},
): Promise<RetentionPlan> {
  const now = opts.now ?? new Date();
  const recordings = await prisma.classRecording.findMany({
    where: { status: "completed", materialId: { not: null } },
    select: {
      id: true,
      materialId: true,
      keepForever: true,
      startedAt: true,
      studentExpiresAt: true,
      sizeBytes: true,
      variant: true,
      material: { select: { title: true, recordedAt: true } },
    },
  });
  if (recordings.length === 0) {
    return { verdicts: [], reclaimable: 0, bytesReclaimable: 0 };
  }

  const verdicts: RetentionVerdict[] = recordings.map((recording) => {
    const recordedAt = recording.material?.recordedAt ?? recording.startedAt;
    const ageDays = days(recordedAt, now);
    const expiredForStudents = isExpiredForStudents(recording, now);

    const base = {
      recordingId: recording.id,
      materialId: recording.materialId,
      title: recording.material?.title ?? "Class recording",
      recordedAt,
      ageDays,
      sizeBytes: recording.sizeBytes ?? 0,
      variant: recording.variant,
      expiredForStudents,
    };

    if (recording.keepForever) {
      return { ...base, decision: "keep" as const, reason: "Marked keep-forever" };
    }
    if (opts.olderThanDays != null && ageDays >= opts.olderThanDays) {
      return {
        ...base,
        decision: "reclaim" as const,
        reason: `${ageDays} days old — past the ${opts.olderThanDays}-day manual purge cutoff`,
      };
    }
    return {
      ...base,
      decision: "keep" as const,
      reason: expiredForStudents
        ? "Off students' shelves; kept for staff (delete is manual only)"
        : "Within the 14-day student window; kept for staff",
    };
  });

  const reclaimable = verdicts.filter((verdict) => verdict.decision === "reclaim");
  return {
    verdicts,
    reclaimable: reclaimable.length,
    bytesReclaimable: reclaimable.reduce((sum, verdict) => sum + verdict.sizeBytes, 0),
  };
}

export type RetentionResult = {
  dryRun: boolean;
  considered: number;
  reclaimed: number;
  bytesReclaimed: number;
  failed: number;
  verdicts: RetentionVerdict[];
};

/**
 * Reclaim what the plan says is reclaimable.
 *
 * Reclaims NOTHING unless `olderThanDays` is given — the default exists so a
 * caller that forgets every argument gets a no-op report rather than a
 * bonfire. `dryRun` still defaults to true on top of that.
 *
 * The order matters: the object goes first, then the library row. If the object
 * delete fails we stop and keep the row, so the library never advertises a
 * video that is no longer there.
 */
export async function applyRetention(
  { dryRun = true, olderThanDays }: { dryRun?: boolean; olderThanDays?: number } = {},
): Promise<RetentionResult> {
  const plan = await planRetention({ olderThanDays });
  const targets = plan.verdicts.filter((verdict) => verdict.decision === "reclaim");

  const result: RetentionResult = {
    dryRun,
    considered: plan.verdicts.length,
    reclaimed: 0,
    bytesReclaimed: 0,
    failed: 0,
    verdicts: plan.verdicts,
  };

  if (dryRun || olderThanDays == null) return result;

  for (const target of targets) {
    const recording = await prisma.classRecording.findUnique({
      where: { id: target.recordingId },
      select: { objectKey: true, materialId: true },
    });
    if (!recording?.objectKey) continue;

    const removed = await deleteRecordingObject(recording.objectKey);
    if (!removed) {
      result.failed += 1;
      continue;
    }

    // Material carries the tile in the library; deleting it is what makes the
    // recording disappear. `ClassRecording` survives as the audit trail —
    // "was Tuesday recorded?" must stay answerable afterwards.
    if (recording.materialId) {
      await prisma.material.delete({ where: { id: recording.materialId } }).catch(() => {});
    }
    await prisma.classRecording.update({
      where: { id: target.recordingId },
      data: { status: "purged", purgedAt: new Date(), fileUrl: null },
    });

    result.reclaimed += 1;
    result.bytesReclaimed += target.sizeBytes;
  }

  return result;
}

export type ShortRecordingVerdict = {
  recordingId: string;
  title: string;
  recordedAt: Date;
  durationSeconds: number;
  sizeBytes: number;
  variant: string;
  /** When the grace window ends and this one becomes eligible for the daily purge. */
  eligibleAt: Date;
  /** True once `shortRecordingGraceHours` has passed — this is what the cron and the "delete now" button both check. */
  graceEligible: boolean;
};

export type ShortRecordingPlan = {
  verdicts: ShortRecordingVerdict[];
  /** How many are past their grace window and would actually be deleted by the cron right now. */
  reclaimable: number;
  bytesReclaimable: number;
};

/**
 * Short GROUP recordings currently on hold — `finaliseRecording` never gives
 * one a Material row, so `materialId: null` on an otherwise-completed,
 * non-private recording IS what marks it as short-and-pending-purge. Reads
 * only — never deletes. A PRIVATE session is excluded regardless of length,
 * same exemption as `isTooShortToKeep`.
 */
export async function planShortRecordingPurge(now: Date = new Date()): Promise<ShortRecordingPlan> {
  const recordings = await prisma.classRecording.findMany({
    where: {
      status: "completed",
      materialId: null,
      privateClassId: null,
      keepForever: false,
      durationSeconds: { lt: RETENTION.minWorthKeepingSeconds },
    },
    select: {
      id: true,
      durationSeconds: true,
      sizeBytes: true,
      variant: true,
      level: true,
      sessionSlot: true,
      startedAt: true,
      endedAt: true,
    },
  });

  const graceMs = RETENTION.shortRecordingGraceHours * 3_600_000;
  const verdicts: ShortRecordingVerdict[] = recordings.map((recording) => {
    const recordedAt = recording.endedAt ?? recording.startedAt;
    const eligibleAt = new Date(recordedAt.getTime() + graceMs);
    return {
      recordingId: recording.id,
      title: `${recording.level ?? "Class"} recording${recording.sessionSlot ? ` — ${recording.sessionSlot}` : ""}`,
      recordedAt,
      durationSeconds: recording.durationSeconds ?? 0,
      sizeBytes: recording.sizeBytes ?? 0,
      variant: recording.variant,
      eligibleAt,
      graceEligible: eligibleAt.getTime() <= now.getTime(),
    };
  });

  const eligible = verdicts.filter((verdict) => verdict.graceEligible);
  return {
    verdicts,
    reclaimable: eligible.length,
    bytesReclaimable: eligible.reduce((sum, verdict) => sum + verdict.sizeBytes, 0),
  };
}

export type ShortRecordingPurgeResult = {
  dryRun: boolean;
  considered: number;
  reclaimed: number;
  bytesReclaimed: number;
  failed: number;
  /** Held but not yet past its grace window — not touched this pass. */
  pending: number;
  verdicts: ShortRecordingVerdict[];
};

/**
 * Permanently delete whichever short recordings the plan says are past their
 * grace window. One still within `shortRecordingGraceHours` of ending is left
 * alone, whatever `dryRun` says — the whole point of the window is that
 * nothing here can jump ahead of it. Same object-then-row order and same
 * "stop on a failed object delete" rule as `applyRetention` — a row is never
 * left pointing at a file that's no longer there.
 */
export async function applyShortRecordingPurge(
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<ShortRecordingPurgeResult> {
  const plan = await planShortRecordingPurge();
  const targets = plan.verdicts.filter((verdict) => verdict.graceEligible);

  const result: ShortRecordingPurgeResult = {
    dryRun,
    considered: plan.verdicts.length,
    reclaimed: 0,
    bytesReclaimed: 0,
    failed: 0,
    pending: plan.verdicts.length - targets.length,
    verdicts: plan.verdicts,
  };

  if (dryRun) return result;

  for (const target of targets) {
    // No Material to delete: a held short recording never had one (that
    // absence is what marked it as pending in the first place).
    const recording = await prisma.classRecording.findUnique({
      where: { id: target.recordingId },
      select: { objectKey: true },
    });
    if (!recording?.objectKey) continue;

    const removed = await deleteRecordingObject(recording.objectKey);
    if (!removed) {
      result.failed += 1;
      continue;
    }

    await prisma.classRecording.update({
      where: { id: target.recordingId },
      data: { status: "purged", purgedAt: new Date(), fileUrl: null },
    });

    result.reclaimed += 1;
    result.bytesReclaimed += target.sizeBytes;
  }

  return result;
}
