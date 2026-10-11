import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { isPartnerStale } from "@/lib/growth/partners";

export const dynamic = "force-dynamic";

/** GET — every partner, flagged for staleness so nobody falls off the radar. */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const partners = await prisma.partner.findMany({
    include: { owner: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      contactName: p.contactName,
      email: p.email,
      phone: p.phone,
      type: p.type,
      status: p.status,
      owner: p.owner,
      notes: p.notes,
      lastContactedAt: p.lastContactedAt,
      createdAt: p.createdAt,
      stale: isPartnerStale(p),
    })),
  });
}

/** POST — add a partner, found through field work or a cold lead. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { name, contactName, email, phone, type } = (body || {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }

  const partner = await prisma.partner.create({
    data: {
      name: name.trim(),
      contactName: typeof contactName === "string" ? contactName.trim() || null : null,
      email: typeof email === "string" ? email.trim() || null : null,
      phone: typeof phone === "string" ? phone.trim() || null : null,
      type: type === "corporate" ? "corporate" : "partner",
      ownerId: gate.admin.userId,
    },
  });

  return NextResponse.json({ ok: true, partnerId: partner.id });
}
