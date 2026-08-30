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

import { prisma } from "@/lib/prisma";
import { deleteRecordingObject } from "@/lib/recording";

export const RETENTION = {
  /**
   * How long a completed recording stays on a STUDENT's shelf, measured from
   * the class date. Enforced as a query filter, never by deletion.
   */
  studentWindowDays: 14,
} as const;

/** Re-exported flat for callers that just want the number. */
export const STUDENT_RECORDING_WINDOW_DAYS = RETENTION.studentWindowDays;

/**
 * The `studentExpiresAt` stamp `class-recorder.ts` writes when a recording is
 * published, and the value the migration backfills onto old rows.
 */
export function studentExpiryFrom(recordedAt: Date): Date {
  return new Date(recordedAt.getTime() + STUDENT_RECORDING_WINDOW_DAYS * 86_400_000);
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
