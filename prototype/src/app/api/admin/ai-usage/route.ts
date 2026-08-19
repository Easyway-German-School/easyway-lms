import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { AI_DAILY_LIMITS } from "@/lib/ai-limits";
import { activeModelName, localModelAvailable } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [requests, recent, tokens, cache] = await Promise.all([
    prisma.studentAiUsage.groupBy({
      by: ["kind"],
      where: { day },
      _sum: { count: true },
      _count: { _all: true },
    }),
    prisma.studentAiUsage.findMany({
      where: { day: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        kind: true,
        count: true,
        day: true,
        updatedAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.usageEvent.aggregate({
      where: { meter: "ai.tokens", occurredAt: { gte: since } },
      _sum: { quantity: true },
    }),
    prisma.aiCache.groupBy({
      by: ["task", "status"],
      _count: { _all: true },
    }),
  ]);

  const today = Object.entries(AI_DAILY_LIMITS).map(([kind, limit]) => ({
    kind,
    limit,
    requests: requests.find((row) => row.kind === kind)?._sum.count ?? 0,
  }));

  return NextResponse.json({
    generatedAt: now.toISOString(),
    provider: {
      interactive: activeModelName(),
      backoffice: activeModelName("backoffice"),
      localAvailable: localModelAvailable(),
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    today,
    tokensLast7Days: tokens._sum.quantity ?? 0,
    recent: recent.map((row) => ({
      kind: row.kind,
      count: row.count,
      day: row.day.toISOString().slice(0, 10),
      updatedAt: row.updatedAt.toISOString(),
      student: row.user.name || row.user.email,
    })),
    cache: cache.map((row) => ({ task: row.task, status: row.status, count: row._count._all })),
  });
}