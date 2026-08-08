import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireSession } from "../../../../../lib/auth";

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

async function requireAdmin(token: string | null) {
  const session = await requireSession(token);
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

export async function GET(req: Request, { params }: { params: { tenantId: string } }) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.partnerConfig.findUnique({ where: { tenantId: params.tenantId } });
  if (!config) {
    return NextResponse.json({ config: null });
  }

  // do not include plaintext apiKey in responses; only indicate config metadata exists
  return NextResponse.json({ config: { plan: config.plan ?? null, metadata: config.metadata ?? null } });
}

export async function PUT(req: Request, { params }: { params: { tenantId: string } }) {
  const token = getBearerToken(req);
  const session = await requireAdmin(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const plan = typeof body?.plan === "string" ? body.plan.trim() : undefined;
  const metadata = body?.metadata;
  const webhookUrl = typeof body?.webhookUrl === "string" ? body.webhookUrl.trim() : undefined;
  const webhookSecret = typeof body?.webhookSecret === "string" ? body.webhookSecret.trim() : undefined;
  const billingCustomerId = typeof body?.billingCustomerId === "string" ? body.billingCustomerId.trim() : undefined;
  const billingPlan = typeof body?.billingPlan === "string" ? body.billingPlan.trim() : undefined;

  const existing = await prisma.partnerConfig.findUnique({ where: { tenantId: params.tenantId } });
  if (!existing) {
    // create if missing
    const created = await prisma.partnerConfig.create({
      data: {
        tenantId: params.tenantId,
        plan: plan ?? undefined,
        metadata: metadata === undefined ? undefined : JSON.stringify(metadata),
        webhookUrl: webhookUrl ?? undefined,
        webhookSecret: webhookSecret ?? undefined,
        billingCustomerId: billingCustomerId ?? undefined,
        billingPlan: billingPlan ?? undefined,
      },
    });
    return NextResponse.json({ config: created });
  }

  const updated = await prisma.partnerConfig.update({
    where: { tenantId: params.tenantId },
    data: {
      plan: plan ?? existing.plan,
      metadata: metadata === undefined ? existing.metadata : JSON.stringify(metadata),
      webhookUrl: webhookUrl ?? existing.webhookUrl,
      webhookSecret: webhookSecret ?? existing.webhookSecret,
      billingCustomerId: billingCustomerId ?? existing.billingCustomerId,
      billingPlan: billingPlan ?? existing.billingPlan,
    },
  });

  return NextResponse.json({ config: updated });
}
