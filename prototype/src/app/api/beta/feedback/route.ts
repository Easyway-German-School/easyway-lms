import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_MESSAGE = 2000;
const KINDS = new Set(["improve", "bug", "love", "idea"]);

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { analyticsConsentAt: true } });
  return NextResponse.json({ analyticsEnabled: Boolean(user?.analyticsConsentAt) });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : "improve";
  const path = typeof body.path === "string" ? body.path.slice(0, 120) : null;
  const analyticsEnabled = Boolean(body.analyticsEnabled);
  if (!message) return NextResponse.json({ error: "Tell Becca what you think" }, { status: 400 });
  if (message.length > MAX_MESSAGE) return NextResponse.json({ error: "Please keep feedback under 2,000 characters" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { tenantId: true } });
  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: { analyticsConsentAt: analyticsEnabled ? new Date() : null },
    }),
    prisma.betaFeedback.create({
      data: {
        userId: session.user.id,
        tenantId: user?.tenantId ?? null,
        kind,
        message,
        path,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  await prisma.user.update({
    where: { id: session.user.id },
    data: { analyticsConsentAt: body.enabled ? new Date() : null },
  });
  return NextResponse.json({ ok: true, enabled: Boolean(body.enabled) });
}
