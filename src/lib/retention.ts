/**
 * Retention — the library reclaims its own storage.
 *
 * A school that records every class forever pays for every class forever, and
 * the honest truth about a class recording is that its usefulness collapses
 * after the cohort has moved on. This decides which tapes have stopped earning
 * their keep and reclaims them.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SAFE TO LET SOFTWARE DELETE THINGS
 * ---------------------------------------------------------------------------
 * Automatic deletion is the kind of feature that quietly destroys something
 * irreplaceable at 3am, so every rule here is a reason to KEEP. A recording is
 * only reclaimed when nothing argues for it:
 *
 *   1. Marked keep-forever?            keep. A human said so; that ends it.
 *   2. Younger than the protected age? keep. The cohort is still catching up.
 *   3. Anyone part-way through it?     keep. Deleting a video a student is
 *                                      halfway through is the single worst
 *                                      thing this could do, and it is exactly
 *                                      what a naive age-based rule would do.
 *   4. Watched by anyone recently?     keep. It is demonstrably still useful.
 *   5. Otherwise                       reclaim.
 *
 * Note that rules 3 and 4 are measured, not assumed — `VideoProgress` already
 * records who watched what and where they stopped. The library knows its own
 * popularity, so retention is driven by evidence rather than by a guess about
 * how long a class stays interesting.
 *
 * And `planRetention()` is separate from `applyRetention()` on purpose: you can
 * always ask what it *would* do, and the answer costs nothing.
 */

import { prisma } from "@/lib/prisma";
import { deleteRecordingObject } from "@/lib/recording";

export const RETENTION = {
  /**
   * Nothing younger than this is ever considered, whatever the numbers say.
   * A term is roughly two months; this covers the cohort's own catch-up plus
   * the students who come back to revise before the level exam.
   */
  protectedDays: 45,
  /** "Nobody has watched it in this long" — the idleness test. */
  idleWindowDays: 60,
  /** Watchers inside the idle window that are enough to save a recording. */
  minRecentWatchers: 1,
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
  const idleSince = new Date(now.getTime() - RETENTION.idleWindowDays * 86_400_000);

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

  // One query for every progress row that could argue for keeping something,
  // rather than one query per recording.
  const progress = await prisma.videoProgress.findMany({
    where: { materialId: { in: recordings.map((r) => r.materialId!) } },
    select: { materialId: true, positionSeconds: true, completed: true, updatedAt: true },
  });

  const midWatch = new Map<string, number>();
  const recentWatchers = new Map<string, number>();
  for (const row of progress) {
    // Started but not finished — someone is in the middle of this.
    if (row.positionSeconds > 30 && !row.completed) {
      midWatch.set(row.materialId, (midWatch.get(row.materialId) ?? 0) + 1);
    }
    if (row.updatedAt >= idleSince) {
      recentWatchers.set(row.materialId, (recentWatchers.get(row.materialId) ?? 0) + 1);
    }
  }

  const verdicts: RetentionVerdict[] = recordings.map((recording) => {
    const recordedAt = recording.material?.recordedAt ?? recording.startedAt;
    const ageDays = days(recordedAt, now);
    const inProgress = midWatch.get(recording.materialId!) ?? 0;
    const recent = recentWatchers.get(recording.materialId!) ?? 0;

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
      return { ...base, decision: "keep" as const, reason: `Only ${ageDays} days old` };
    }
    if (inProgress > 0) {
      return {
        ...base,
        decision: "keep" as const,
        reason: `${inProgress} student${inProgress === 1 ? " is" : "s are"} part-way through`,
      };
    }
    if (recent >= RETENTION.minRecentWatchers) {
      return {
        ...base,
        decision: "keep" as const,
        reason: `Watched by ${recent} in the last ${RETENTION.idleWindowDays} days`,
      };
    }
    return {
      ...base,
      decision: "reclaim" as const,
      reason: `${ageDays} days old, nobody has watched it in ${RETENTION.idleWindowDays}`,
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
