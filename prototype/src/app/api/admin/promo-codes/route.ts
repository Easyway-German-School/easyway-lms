import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { currentTenantId } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

/** List every promo code (both programs) for the super-admin oversight page. */
export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const codes = await prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      label: true,
      discountPercent: true,
      discountFlat: true,
      discountCapAmount: true,
      commissionPercent: true,
      commissionFlat: true,
      createdAt: true,
      ownerStudent: { select: { user: { select: { name: true, email: true } } } },
      ownerUser: { select: { name: true, email: true } },
      _count: { select: { redemptions: true } },
    },
  });

  return NextResponse.json({ codes });
}

/**
 * Create a new influencer code. Student-referral codes are never created
 * here — one is minted automatically for every student at signup.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const {
    code,
    label,
    ownerEmail,
    discountPercent,
    discountFlat,
    discountCapAmount,
    commissionPercent,
    commissionFlat,
    notes,
  } = (body || {}) as Record<string, unknown>;

  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  const normalizedEmail = typeof ownerEmail === "string" ? ownerEmail.trim().toLowerCase() : "";
  if (!normalizedCode) {
    return NextResponse.json({ error: "A code is required" }, { status: 400 });
  }
  if (!normalizedEmail) {
    return NextResponse.json({ error: "The influencer's admin account email is required" }, { status: 400 });
  }

  const owner = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, role: true, adminRole: true } });
  if (!owner || String(owner.role).toLowerCase() !== "admin" || owner.adminRole !== "influencer") {
    return NextResponse.json(
      { error: "No influencer admin account found for that email. Invite them at /admin/staff with the Influencer role first." },
      { status: 404 },
    );
  }

  const toNullableInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  try {
    const created = await prisma.promoCode.create({
      data: {
        code: normalizedCode,
        type: "influencer",
        status: "active",
        ownerUserId: owner.id,
        label: typeof label === "string" && label.trim() ? label.trim() : null,
        discountPercent: toNullableInt(discountPercent),
        discountFlat: toNullableInt(discountFlat),
        discountCapAmount: toNullableInt(discountCapAmount),
        commissionPercent: toNullableInt(commissionPercent),
        commissionFlat: toNullableInt(commissionFlat),
        notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
        createdById: gate.admin.userId,
        tenantId: currentTenantId(),
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (error) {
    const message = String((error as { code?: string })?.code) === "P2002" ? "That code is already in use." : "Unable to create the code.";
    console.error("Admin promo-codes POST failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
