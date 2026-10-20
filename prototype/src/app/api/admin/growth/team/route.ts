import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeGrowthTitle, GROWTH_TITLE_LABELS } from "@/lib/growth/titles";
import { startOfToday } from "@/lib/growth/reports";

export const dynamic = "force-dynamic";

/**
 * GET — one row per Growth Desk account: what's on their plate right now
 * and what they've actually done today. This is the "ensures team
 * performance" half of the Sales & Marketing Teamlead's job from the
 * handbook — made out of data the system is already collecting (SalesTask,
 * Lead, DailyReport), not a new tracking system bolted on top.
 */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const reps = await prisma.user.findMany({
    where: { role: "ADMIN", adminRole: "growth", deletedAt: null },
    select: { id: true, name: true, email: true, growthTitle: true },
    orderBy: { name: "asc" },
  });

  const today = startOfToday();

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const [pendingTasks, doneToday, leadsAssigned, leadsConverted, report] = await Promise.all([
        prisma.salesTask.count({ where: { assignedToId: rep.id, status: "pending" } }),
        prisma.salesTask.count({ where: { assignedToId: rep.id, status: "done", completedAt: { gte: today } } }),
        prisma.lead.count({ where: { assignedToId: rep.id } }),
        prisma.lead.count({ where: { assignedToId: rep.id, status: "converted" } }),
        prisma.dailyReport.findUnique({
          where: { authorId_reportDate: { authorId: rep.id, reportDate: today } },
          select: { id: true },
        }),
      ]);

      const title = normalizeGrowthTitle(rep.growthTitle);
      return {
        id: rep.id,
        name: rep.name,
        email: rep.email,
        title,
        titleLabel: GROWTH_TITLE_LABELS[title],
        pendingTasks,
        doneToday,
        leadsAssigned,
        leadsConverted,
        reportedToday: Boolean(report),
      };
    }),
  );

  return NextResponse.json({ reps: rows });
}
