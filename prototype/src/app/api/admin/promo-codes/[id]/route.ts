import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

const EDITABLE_AMOUNT_FIELDS = [
  "discountPercent",
  "discountFlat",
  "discountCapAmount",
  "commissionPercent",
  "commissionFlat",
] as const;

/** Edit a code's reward config, label, or status (active/paused/revoked). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A request body is required" }, { status: 400 });
  }

  const data: Record<string, number | string | null> = {};

  for (const field of EDITABLE_AMOUNT_FIELDS) {
    if (!(field in body)) continue;
    const raw = (body as Record<string, unknown>)[field];
    if (raw === null || raw === "") {
      data[field] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
    }
    data[field] = Math.round(n);
  }

  if ("label" in body) {
    const label = (body as Record<string, unknown>).label;
    data.label = typeof label === "string" && label.trim() ? label.trim() : null;
  }

  if ("notes" in body) {
    const notes = (body as Record<string, unknown>).notes;
    data.notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  if ("status" in body) {
    const status = (body as Record<string, unknown>).status;
    if (status !== "active" && status !== "paused" && status !== "revoked") {
      return NextResponse.json({ error: "status must be active, paused or revoked" }, { status: 400 });
    }
    data.status = status;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await prisma.promoCode.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin promo-codes PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the code" }, { status: 400 });
  }
}
