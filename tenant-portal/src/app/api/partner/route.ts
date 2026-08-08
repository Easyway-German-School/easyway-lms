import { NextResponse } from "next/server";
import { requireSession } from "../../../lib/auth";
import { getPartnerConfig } from "../../../lib/tenant";
import { prisma } from "../../../lib/prisma";

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.replace("Bearer ", "").trim();
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  const session = await requireSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.tenantId) {
    return NextResponse.json({ error: "Tenant required" }, { status: 403 });
  }

  const config = await getPartnerConfig(session.tenantId);
  if (!config) {
    return NextResponse.json({ error: "Partner config not found" }, { status: 404 });
  }

  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const token = getBearerToken(req);
  const session = await requireSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.tenantId) {
    return NextResponse.json({ error: "Tenant required" }, { status: 403 });
  }

  const body = await req.json();
  const plan = typeof body?.plan === "string" ? body.plan.trim() : undefined;
  const metadata = body?.metadata;
  const webhookUrl = typeof body?.webhookUrl === "string" ? body.webhookUrl.trim() : undefined;
  const webhookSecret = typeof body?.webhookSecret === "string" ? body.webhookSecret.trim() : undefined;
  const billingCustomerId = typeof body?.billingCustomerId === "string" ? body.billingCustomerId.trim() : undefined;
  const billingPlan = typeof body?.billingPlan === "string" ? body.billingPlan.trim() : undefined;

  if (
    plan === undefined &&
    metadata === undefined &&
    webhookUrl === undefined &&
    webhookSecret === undefined &&
    billingCustomerId === undefined &&
    billingPlan === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const existing = await getPartnerConfig(session.tenantId);
  if (!existing) {
    return NextResponse.json({ error: "Partner config not found" }, { status: 404 });
  }

  const updated = await prisma.partnerConfig.update({
    where: { tenantId: session.tenantId },
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
