import { prisma } from "@/lib/prisma";
import { batchOfAdmission, compareBatches } from "@/lib/class-batch";

/**
 * Which batches a class (branch + level + sitting) actually has students in.
 *
 * Feeds the batch picker on the timetable — "September batch · 14 students" next
 * to "October batch · 9 students" — and, just as important, answers the
 * question the server asks before any write to a class day: is this a class with
 * more than one batch in it, so that "which one?" has to be answered?
 */
export type CohortBatches = {
  /** Chronological: the batch that started first first. */
  batches: Array<{ batch: string; students: number }>;
  /** Active students in the class with no intake month on record. */
  unplaced: number;
};

export async function batchesForCohort(args: {
  branchId: string;
  level: string;
  sessionSlot: string;
}): Promise<CohortBatches> {
  const rows = await prisma.student.findMany({
    where: {
      branchId: args.branchId,
      level: args.level.toUpperCase(),
      sessionSlot: args.sessionSlot.toLowerCase(),
      status: "active",
      deletedAt: null,
    },
    select: { admission: true },
  });

  const counts = new Map<string, number>();
  let unplaced = 0;
  for (const row of rows) {
    const batch = batchOfAdmission(row.admission);
    if (!batch) unplaced += 1;
    else counts.set(batch, (counts.get(batch) ?? 0) + 1);
  }

  return {
    batches: [...counts.entries()]
      .map(([batch, students]) => ({ batch, students }))
      .sort((a, b) => compareBatches(a.batch, b.batch)),
    unplaced,
  };
}
