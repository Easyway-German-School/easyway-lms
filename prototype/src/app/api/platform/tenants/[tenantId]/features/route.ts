import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";
import { FEATURES_KEY, defaultFeatures, parseFeatures } from "@/lib/tenant/features";
import { forgetFeatures } from "@/lib/tenant/features-server";

export const dynamic = "force-dynamic";

/**
 * What a school can do on the platform.
 *
 * A separate route from the tenant `PATCH` next door on purpose: that one
 * writes columns on `Tenant` in a single `update`, this one writes a
 * `SchoolSetting` row with its own validation and its own cache to clear.
 * Folding them into one handler means a colour save and a feature toggle
 * share a transaction that has no reason to be shared, and the first thing
 * that goes wrong is one of them silently clobbering the other.
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;

  const existing = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "No such school." }, { status: 404 });

  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId, key: FEATURES_KEY },
    select: { value: true },
  });

  return NextResponse.json({
    features: parseFeatures(row?.value ?? null),
    defaults: defaultFeatures(),
    // The raw stored value, so the console can tell "on because default" from
    // "on because you set it" rather than showing every toggle as a decision.
    overrides: row?.value ?? null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;

  const existing = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "No such school." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = parseFeatures(body, { strict: true });
  if (!parsed) {
    return NextResponse.json(
      { error: "That isn't a valid feature configuration." },
      { status: 400 },
    );
  }

  /**
   * `tenantId` passed explicitly in `create`. `requirePlatformOperator()`
   * runs unscoped by design (an operator administers every tenant), and the
   * isolation extension only auto-stamps `tenantId` on a query running inside
   * a tenant scope — see tenant/context.ts. Writing here without it would
   * throw, not silently mis-tag the row, but the explicit value is also what
   * makes it obvious on read which tenant this write belongs to.
   */
  await guardedPrisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: FEATURES_KEY } },
    create: { tenantId, key: FEATURES_KEY, value: parsed },
    update: { value: parsed },
  });

  forgetFeatures();

  return NextResponse.json({ features: parsed });
}
