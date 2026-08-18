/**
 * Retention — the library reclaims its own storage.
 *
 * A school that records every class forever pays for every class forever, and
 * a class recording exists to let this week's cohort catch up on this week's
 * lesson — not to become a permanent video archive. The policy is deliberately
 * blunt: a recording lives for one week, then it is gone.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HARD CUTOFF, NOT AN EVIDENCE-BASED ONE
 * ---------------------------------------------------------------------------
 * An earlier version of this policy kept a recording alive past its age if
 * somebody was mid-watch or had watched recently, and only reclaimed it after
 * 45-60 days of genuine idleness. That is the right shape for a video archive.
 * It is the wrong shape for "one week and it's gone" — a rule with exceptions
 * for staying useful is not a one-week rule, it is a "however long it stays
 * useful" rule, which is a different feature. If a week genuinely is not
 * enough for a given cohort, the fix is `keepForever` on that one recording
 * (a human decision, made once), not a blanket exception that quietly extends
 * every recording's life indefinitely.
 *
 * Only two things argue for keeping a recording past the week:
 *
 *   1. Marked keep-forever?            keep. A human said so; that ends it.
 *   2. Younger than 7 days?            keep. Its week is not up yet.
 *   3. Otherwise                       reclaim.
 *
 * `planRetention()` is separate from `applyRetention()` on purpose: you can
 * always ask what it *would* do, and the answer costs nothing.
 */

import { prisma } from "@/lib/prisma";
import { deleteRecordingObject } from "@/lib/recording";

export const RETENTION = {
  /** A recording's whole lifespan. Nothing younger than this is ever touched. */
  protectedDays: 7,
} as const;

export type RetentionDecision = "keep" | "reclaim";

export type RetentionVerdict = {
  recordingId: string;
  materialId: string | null;
  title: string;
  recordedAt: Date;
  ageDays: number;
  sizeBytes: number;
  variant: string;
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
 * What retention would do right now. Reads only — never deletes.
 */
export async function planRetention(now: Date = new Date()): Promise<RetentionPlan> {
  const recordings = await prisma.classRecording.findMany({
    where: { status: "completed", materialId: { not: null } },
    select: {
      id: true,
      materialId: true,
      keepForever: true,
      startedAt: true,
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

    const base = {
      recordingId: recording.id,
      materialId: recording.materialId,
      title: recording.material?.title ?? "Class recording",
      recordedAt,
      ageDays,
      sizeBytes: recording.sizeBytes ?? 0,
      variant: recording.variant,
    };

    if (recording.keepForever) {
      return { ...base, decision: "keep" as const, reason: "Marked keep-forever" };
    }
    if (ageDays < RETENTION.protectedDays) {
      return { ...base, decision: "keep" as const, reason: `Only ${ageDays} of ${RETENTION.protectedDays} days old` };
    }
    return {
      ...base,
      decision: "reclaim" as const,
      reason: `${ageDays} days old — past its ${RETENTION.protectedDays}-day lifespan`,
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
 * `dryRun` defaults to true. Deleting is the kind of thing that should have to
 * be asked for twice, and a caller that forgets the flag gets a report rather
 * than a bonfire.
 *
 * The order matters: the object goes first, then the library row. If the object
 * delete fails we stop and keep the row, so the library never advertises a
 * video that is no longer there. The reverse order would strand files nobody
 * has a record of — invisible storage, paid for forever.
 */
export async function applyRetention({ dryRun = true }: { dryRun?: boolean } = {}): Promise<RetentionResult> {
  const plan = await planRetention();
  const targets = plan.verdicts.filter((verdict) => verdict.decision === "reclaim");

  const result: RetentionResult = {
    dryRun,
    considered: plan.verdicts.length,
    reclaimed: 0,
    bytesReclaimed: 0,
    failed: 0,
    verdicts: plan.verdicts,
  };

  if (dryRun) return result;

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
    // recording disappear from the shelf. `ClassRecording` survives as the
    // audit trail — "was Tuesday recorded?" must stay answerable afterwards.
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
