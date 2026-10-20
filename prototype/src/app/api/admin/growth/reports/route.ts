import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { upsertDailyReport, startOfToday } from "@/lib/growth/reports";

export const dynamic = "force-dynamic";

/** GET — today's team reports, newest first, plus whether I've filed mine. */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const reportDate = startOfToday();
  const reports = await prisma.dailyReport.findMany({
    where: { reportDate },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    reports,
    mine: reports.find((r) => r.authorId === gate.admin.userId) ?? null,
  });
}

/** POST — file (or update) today's report. One per person per day. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { achievement, problemSolved } = (body || {}) as Record<string, unknown>;

  if (typeof achievement !== "string" || !achievement.trim()) {
    return NextResponse.json({ error: "What got done today is required" }, { status: 400 });
  }

  await upsertDailyReport({
    authorId: gate.admin.userId,
    achievement: achievement.trim(),
    problemSolved: typeof problemSolved === "string" ? problemSolved.trim() || null : null,
  });

  return NextResponse.json({ ok: true });
}
