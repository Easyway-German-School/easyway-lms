import bcryptjs from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { currentTenantId } from "@/lib/tenant/context";
import { generateTempPassword } from "@/lib/student-password";

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
      partnerType: true,
      discountPercent: true,
      discountFlat: true,
      discountCapAmount: true,
      commissionPercent: true,
      commissionFlat: true,
      createdAt: true,
      ownerStudent: { select: { user: { select: { name: true, email: true } } } },
      ownerUser: { select: { id: true, name: true, email: true } },
      _count: { select: { redemptions: true } },
    },
  });

  return NextResponse.json({ codes });
}

const PARTNER_TYPES = ["influencer", "travel_agent", "ambassador", "other"] as const;

/**
 * Add a partner to the Influencer Program: one submission creates BOTH the
 * code AND, if nobody already has an admin account at that email, the
 * account itself (adminRole "influencer", a generated password returned
 * once in the response for the admin to relay). Previously this required a
 * separate trip to /admin/staff first — the account and the code it's
 * linked to were two manual steps an admin had to keep in sync by hand.
 * An email that already belongs to an influencer account is linked as-is
 * (e.g. a second code for the same partner); any other existing account
 * (a different role, or already revoked) is refused rather than silently
 * repurposed.
 *
 * Student-referral codes are never created here — one is minted
 * automatically for every student at signup.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const {
    code,
    label,
    ownerEmail,
    ownerName,
    partnerType,
    discountPercent,
    discountFlat,
    discountCapAmount,
    commissionPercent,
    commissionFlat,
    notes,
  } = (body || {}) as Record<string, unknown>;

  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  const normalizedEmail = typeof ownerEmail === "string" ? ownerEmail.trim().toLowerCase() : "";
  const normalizedName = typeof ownerName === "string" ? ownerName.trim() : "";
  const normalizedPartnerType = PARTNER_TYPES.includes(partnerType as (typeof PARTNER_TYPES)[number])
    ? (partnerType as (typeof PARTNER_TYPES)[number])
    : "influencer";

  if (!normalizedCode) {
    return NextResponse.json({ error: "A code is required" }, { status: 400 });
  }
  if (!normalizedEmail) {
    return NextResponse.json({ error: "The partner's email is required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, role: true, adminRole: true } });
  if (existing && (String(existing.role).toLowerCase() !== "admin" || existing.adminRole !== "influencer")) {
    return NextResponse.json(
      { error: "That email already belongs to a different kind of account. Use a different address." },
      { status: 409 },
    );
  }
  if (!existing && !normalizedName) {
    return NextResponse.json({ error: "A name is required to create their account" }, { status: 400 });
  }

  const toNullableInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const generatedPassword = existing ? null : generateTempPassword();

  try {
    // One transaction: if the code fails to create (e.g. a duplicate code),
    // a brand-new account is never left dangling with a password nobody
    // was ever shown.
    const result = await prisma.$transaction(async (tx) => {
      const ownerId = existing
        ? existing.id
        : (
            await tx.user.create({
              data: {
                name: normalizedName,
                email: normalizedEmail,
                password: await bcryptjs.hash(generatedPassword!, 10),
                role: "ADMIN",
                adminRole: "influencer",
              },
              select: { id: true },
            })
          ).id;

      const createdCode = await tx.promoCode.create({
        data: {
          code: normalizedCode,
          type: "influencer",
          status: "active",
          partnerType: normalizedPartnerType,
          ownerUserId: ownerId,
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

      return { id: createdCode.id, ownerId };
    });

    return NextResponse.json({ ok: true, id: result.id, ownerId: result.ownerId, generatedPassword });
  } catch (error) {
    const message = String((error as { code?: string })?.code) === "P2002" ? "That code is already in use." : "Unable to create the code.";
    console.error("Admin promo-codes POST failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
