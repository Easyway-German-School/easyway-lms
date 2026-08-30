import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";
import { billingSettingsFor, saveBillingSettings } from "@/lib/usage/billing-settings";
import { forgetCredit } from "@/lib/usage/guard";

export const dynamic = "force-dynamic";

/**
 * A school's billing enforcement.
 *
 * `enforce` is off for every tenant until an operator turns it on here. Off, a
 * negative balance is only a warning; on, metered work is refused once
 * `balanceKobo + graceKobo` goes below zero. `graceKobo` is extra headroom on
 * top of `TenantCredit.graceKobo`.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const [settings, credit] = await Promise.all([
    billingSettingsFor(tenantId),
    guardedPrisma.tenantCredit.findUnique({
      where: { tenantId },
      select: { balanceKobo: true, graceKobo: true },
    }),
  ]);

  return NextResponse.json({
    settings,
    credit: credit
      ? { balanceKobo: credit.balanceKobo.toString(), graceKobo: credit.graceKobo.toString() }
      : null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const tenant = await guardedPrisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "No such school." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const patch: { enforce?: boolean; graceKobo?: string } = {};
  if (typeof body?.enforce === "boolean") patch.enforce = body.enforce;
  if (body?.graceKobo !== undefined) {
    try {
      patch.graceKobo = BigInt(String(body.graceKobo)).toString();
    } catch {
      return NextResponse.json({ error: "graceKobo must be a whole number of kobo." }, { status: 400 });
    }
  }

  const settings = await saveBillingSettings(tenantId, patch);
  forgetCredit(tenantId);
  return NextResponse.json({ settings });
}
