import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";
import { validateBrandingInput } from "@/lib/tenant/branding";
import { FEATURES_KEY, parseFeatures } from "@/lib/tenant/features";
import { forgetFeatures } from "@/lib/tenant/features-server";
import { forgetBranding } from "@/lib/tenant/branding-server";
import { forgetTenantHosts } from "@/lib/tenant/resolve";

export const dynamic = "force-dynamic";

/**
 * The schools on the platform.
 *
 * Reads the aggregate a customer conversation actually needs — how many
 * students, what they owe us, when they were last active — rather than a bare
 * list of names. An operator dashboard that requires four clicks per tenant to
 * answer "who is about to run out of credit" gets replaced by a spreadsheet.
 */
export async function GET() {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const tenants = await guardedPrisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      domain: true,
      brandName: true,
      // Sent so the console can edit them in place. They are public-facing
      // values by nature — a logo and a colour are what a visitor sees before
      // they sign in — so there is nothing here to withhold from an operator.
      logoUrl: true,
      primaryColor: true,
      trialEndsAt: true,
      createdAt: true,
      credit: { select: { balanceKobo: true, lowBalanceKobo: true } },
      _count: { select: { users: true, students: true, apiKeys: true } },
    },
  });

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      ...t,
      // BigInt does not survive JSON.stringify. Sent as a string rather than a
      // number so that a large balance cannot lose precision on the way.
      credit: t.credit
        ? {
            balanceKobo: t.credit.balanceKobo.toString(),
            lowBalanceKobo: t.credit.lowBalanceKobo.toString(),
          }
        : null,
    })),
  });
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Onboard a school.
 *
 * Creates the tenant, its credit row, and — optionally, in the same
 * transaction — its initial branding and feature configuration. Onboarding
 * used to be create-then-edit-then-toggle across three separate round trips
 * to three different sections of the console; an operator setting up a real
 * client can now do it in one. A tenant without a credit row is a tenant
 * whose first metered request has to decide what to do about a missing
 * balance, and "create it on the fly" is how two concurrent requests create
 * two — the same reasoning extends to shipping the feature row atomically
 * with the tenant rather than as a follow-up write that could be lost.
 */
export async function POST(request: NextRequest) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const domain = String(body?.domain ?? "").trim().toLowerCase() || null;

  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (!SLUG.test(slug)) {
    return NextResponse.json(
      {
        error:
          "The slug must be 3–40 characters of lowercase letters, numbers and hyphens, starting and ending with a letter or number.",
      },
      { status: 400 },
    );
  }

  const branding = validateBrandingInput(body ?? {});
  if (!branding.ok) {
    return NextResponse.json({ error: branding.error }, { status: 400 });
  }
  const brandName = "brandName" in (body ?? {}) ? String(body.brandName ?? "").trim() || null : undefined;

  let features: ReturnType<typeof parseFeatures> | undefined;
  if (body && "features" in body) {
    const parsed = parseFeatures(body.features, { strict: true });
    if (!parsed) {
      return NextResponse.json(
        { error: "That isn't a valid feature configuration." },
        { status: 400 },
      );
    }
    features = parsed;
  }

  const clash = await guardedPrisma.tenant.findFirst({
    where: { OR: [{ slug }, ...(domain ? [{ domain }] : [])] },
    select: { slug: true, domain: true },
  });
  if (clash) {
    return NextResponse.json(
      {
        error:
          clash.slug === slug
            ? `A school already uses the slug "${slug}".`
            : `A school already answers on ${domain}.`,
      },
      { status: 409 },
    );
  }

  const tenant = await guardedPrisma.tenant.create({
    data: {
      name,
      slug,
      domain,
      status: "active",
      plan: String(body?.plan ?? "trial"),
      /**
       * Thirty days, and an explicit date rather than "trial means 30 days"
       * computed at read time. A customer who is given an extension should have
       * that recorded as a fact about them, not as an exception somebody has to
       * remember.
       */
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...(brandName !== undefined ? { brandName } : {}),
      ...(branding.patch.logoUrl !== undefined ? { logoUrl: branding.patch.logoUrl } : {}),
      ...(branding.patch.primaryColor !== undefined ? { primaryColor: branding.patch.primaryColor } : {}),
      credit: { create: {} },
      ...(features ? { schoolSettings: { create: { key: FEATURES_KEY, value: features } } } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      plan: true,
      trialEndsAt: true,
      brandName: true,
      logoUrl: true,
      primaryColor: true,
    },
  });

  // Cheap to drop, and an operator who just picked a domain and a colour for
  // a brand-new school should not see stale (empty) branding on their own
  // very next load. Same reasoning as the tenant PATCH.
  forgetBranding();
  forgetTenantHosts();
  forgetFeatures();

  return NextResponse.json({ tenant, features: features ?? null }, { status: 201 });
}
