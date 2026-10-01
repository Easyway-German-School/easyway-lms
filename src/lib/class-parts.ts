/**
 * One class can be recorded in SEVERAL PARTS.
 *
 * A capture is cut into parts whenever it is interrupted: LiveKit's own 170-minute
 * restart, or a recorder crash (the tutor's page pings every ~45 s, notices no
 * capture is running and starts a new one: `…-2.mp4`). Each part is its own
 * `ClassRecording` row with its own file.
 *
 * THE FLAW THIS FIXES. "Is this recording too short to keep?" (retention.ts) used
 * to be asked of each part ON ITS OWN. A crash 25 minutes before the end of a
 * 3-hour class leaves a 25-minute tail part, which is "short", so it was held for
 * 48 hours and then deleted: the end of a real lesson silently lost. The same
 * happened to a short first part of a class that carried on afterwards.
 *
 * The question that actually matters is "was this a real class?", and that is
 * answered by the class's TOTAL recorded time. These helpers decide which rows
 * belong to the same class and add them up. They are pure (no database) so the
 * rule can be tested exactly; the callers fetch the candidate rows.
 */

export type PartRow = {
  id: string;
  roomName: string;
  startedAt: Date;
  status: string;
  durationSeconds: number | null;
  materialId: string | null;
  objectKey: string | null;
  privateClassId?: string | null;
  /** Needed to re-finalise a held part. */
  egressId?: string;
  sizeBytes?: number | null;
};

/** UTC midnight bounds of the day a part started on: the window in which to look for its sibling parts. */
export function classDayBounds(startedAt: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()));
  return { from, to: new Date(from.getTime() + 24 * 3_600_000) };
}

/** Same calendar day in UTC. A class never spans midnight UTC (slots run 10:00-19:00 Lagos = 09:00-18:00 UTC). */
export function sameClassDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** The other parts of the same class as `self`: same room, same day, not `self`. */
export function otherPartsOf(self: Pick<PartRow, "id" | "roomName" | "startedAt">, rows: PartRow[]): PartRow[] {
  return rows.filter((row) => row.id !== self.id && row.roomName === self.roomName && sameClassDay(row.startedAt, self.startedAt));
}

/**
 * Seconds of this class recorded in the OTHER parts.
 *
 * Counts "completed" and "purged" parts: a purged part was real footage whose file has
 * been cleaned up, so it still proves the class ran. Failed/aborted/active parts have
 * no usable duration and add nothing.
 */
export function otherPartsSeconds(others: PartRow[]): number {
  return others
    .filter((row) => row.status === "completed" || row.status === "purged")
    .reduce((sum, row) => sum + Math.max(0, row.durationSeconds ?? 0), 0);
}

/**
 * Parts of the class that were HELD as "too short" and never reached the shelf, and whose
 * file still exists: completed, no shelf entry, not a private lesson. Once the class is
 * known to be real, these are the ones to rescue.
 */
export function heldParts(others: PartRow[]): PartRow[] {
  return others.filter((row) => row.status === "completed" && !row.materialId && !row.privateClassId && Boolean(row.objectKey));
}
