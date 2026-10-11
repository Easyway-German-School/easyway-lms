import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { logPartnerContact } from "@/lib/growth/partners";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["prospecting", "engaged", "cooperating", "dormant"]);

/**
 * PATCH — the only two things this screen does to a partner: log that
 * someone reached out (bumps lastContactedAt), or change its status.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { action } = (body || {}) as Record<string, unknown>;

  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  if (action === "log-contact") {
    const { note } = body as Record<string, unknown>;
    await logPartnerContact({ partnerId: id, note: typeof note === "string" ? note : null });
    return NextResponse.json({ ok: true });
  }

  if (action === "status") {
    const { status } = body as Record<string, unknown>;
    if (typeof status !== "string" || !STATUSES.has(status)) {
      return NextResponse.json({ error: "Unrecognised status" }, { status: 400 });
    }
    await prisma.partner.update({ where: { id }, data: { status } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action "${String(action)}"` }, { status: 400 });
}
