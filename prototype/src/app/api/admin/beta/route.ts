import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [feedback, usage, consented] = await Promise.all([
      prisma.betaFeedback.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, kind: true, message: true, path: true, status: true, createdAt: true, user: { select: { name: true, email: true } } },
      }),
      prisma.learnerUsageEvent.groupBy({
        by: ["area"],
        where: { occurredAt: { gte: since } },
        _sum: { durationSeconds: true },
        _count: { userId: true },
        orderBy: { _sum: { durationSeconds: "desc" } },
        take: 30,
      }),
      prisma.user.count({ where: { analyticsConsentAt: { not: null } } }),
    ]);

    const patterns = await prisma.learnerUsageEvent.groupBy({
      by: ["action", "area"],
      where: { occurredAt: { gte: since } },
      _count: { userId: true },
      orderBy: { _count: { userId: "desc" } },
      take: 20,
    });
    return NextResponse.json({
      windowDays: 30,
      consentedStudents: consented,
      feedback,
      usage: usage.map((row) => ({ area: row.area, seconds: row._sum.durationSeconds ?? 0, events: row._count.userId })),
      patterns: patterns.map((row) => ({ area: row.area, action: row.action, events: row._count.userId })),
    });
  } catch (error) {
    console.error("Admin beta report failed", error);
    return NextResponse.json({ error: "Could not load beta insights" }, { status: 500 });
  }
}
