import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_DURATION = 300;

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { analyticsConsentAt: true, tenantId: true } });
  if (!user?.analyticsConsentAt) return NextResponse.json({ ok: true, recorded: false });

  const body = await request.json().catch(() => ({}));
  const area = typeof body.area === "string" ? body.area.slice(0, 80) : "unknown";
  const action = typeof body.action === "string" ? body.action.slice(0, 40) : "view";
  const durationSeconds = Math.max(0, Math.min(MAX_DURATION, Number(body.durationSeconds) || 0));
  if (!area || area === "unknown") return NextResponse.json({ ok: true, recorded: false });

  await prisma.learnerUsageEvent.create({
    data: {
      userId: session.user.id,
      tenantId: user.tenantId ?? null,
      area,
      action,
      durationSeconds,
    },
  });
  return NextResponse.json({ ok: true, recorded: true });
}
