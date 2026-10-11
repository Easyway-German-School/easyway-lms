import { prisma } from "@/lib/prisma";

/** Midnight in the server's own time zone — the unique key for one day's report. */
export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * One row per person per day. Submitting again today updates today's row —
 * see the schema comment on DailyReport for why that is a feature, not a
 * missing validation.
 */
export async function upsertDailyReport(opts: {
  authorId: string;
  achievement: string;
  problemSolved?: string | null;
}) {
  const reportDate = startOfToday();
  return prisma.dailyReport.upsert({
    where: { authorId_reportDate: { authorId: opts.authorId, reportDate } },
    create: {
      authorId: opts.authorId,
      reportDate,
      achievement: opts.achievement,
      problemSolved: opts.problemSolved ?? null,
    },
    update: {
      achievement: opts.achievement,
      problemSolved: opts.problemSolved ?? null,
    },
  });
}
