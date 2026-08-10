import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";
import { isSafeColor, isSafeLogo } from "@/lib/tenant/branding";
import { forgetBranding } from "@/lib/tenant/branding-server";
import { forgetTenantHosts } from "@/lib/tenant/resolve";

export const dynamic = "force-dynamic";

/**
 * Change a school's identity on the platform: its domain, its plan, its
 * standing, and how it looks.
 *
 * The brand columns have been on `Tenant` since the platform layer landed with
 * nothing that could write them — onboarding took a name, a slug and a domain,
 * and there was no second step. So white-labelling was a schema, not a feature.
 * This is the second step.
 */

const SLUG_SAFE_STATUS = new Set(["active", "suspended", "cancelled"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Send some JSON." }, { status: 400 });

  const existing = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, domain: true },
  });
  if (!existing) return NextResponse.json({ error: "No such school." }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }

  /**
   * The display name and the legal name are separate fields on purpose. A
   * school is invoiced as "Bright Star Educational Services Ltd" and greets its
   * students as "Bright Star" — forcing one string to do both jobs means one of
   * those two places reads wrong forever.
   *
   * An empty string clears it back to using `name`, which is why this checks
   * for the key rather than for truthiness.
   */
  if ("brandName" in body) {
    const value = String(body.brandName ?? "").trim();
    data.brandName = value || null;
  }

  if ("logoUrl" in body) {
    const value = String(body.logoUrl ?? "").trim();
    if (value && !isSafeLogo(value)) {
      return NextResponse.json(
        {
          error:
            "The logo must be an https URL or a path on this site. Plain http is blocked as mixed content by the browser, so the logo would simply never appear.",
        },
        { status: 400 },
      );
    }
    data.logoUrl = value || null;
  }

  if ("primaryColor" in body) {
    const value = String(body.primaryColor ?? "").trim();
    if (value && !isSafeColor(value)) {
      return NextResponse.json(
        { error: "The colour must be a hex value such as #FF6600." },
        { status: 400 },
      );
    }
    data.primaryColor = value || null;
  }

  if ("domain" in body) {
    const value = String(body.domain ?? "").trim().toLowerCase() || null;
    if (value) {
      const clash = await guardedPrisma.tenant.findFirst({
        where: { domain: value, NOT: { id: tenantId } },
        select: { name: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `${clash.name} already answers on ${value}.` },
          { status: 409 },
        );
      }
    }
    data.domain = value;
  }

  if (typeof body.plan === "string" && body.plan.trim()) {
    data.plan = body.plan.trim();
  }

  if (typeof body.status === "string") {
    if (!SLUG_SAFE_STATUS.has(body.status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${[...SLUG_SAFE_STATUS].join(", ")}.` },
        { status: 400 },
      );
    }
    data.status = body.status;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const tenant = await guardedPrisma.tenant.update({
    where: { id: tenantId },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      domain: true,
      brandName: true,
      logoUrl: true,
      primaryColor: true,
    },
  });

  /**
   * BOTH CACHES, ALWAYS, EVEN WHEN THE DOMAIN DID NOT CHANGE.
   *
   * The host→tenant map and the host→branding map are each keyed by hostname
   * and each hold for sixty seconds. Changing a colour and being told to wait a
   * minute to see whether it took is the kind of thing that gets diagnosed as
   * "the save button does not work" and reported as a bug — and an operator
   * mid-onboarding will click save three more times before the first one
   * surfaces. Clearing is cheap; the next request repopulates.
   *
   * Neither cache survives a cold start on a new serverless instance anyway, so
   * this is correctness for the operator's own session rather than a guarantee
   * across the fleet. A tenant's own users still see the old colour for up to a
   * minute, which is the right trade for one database read per page load.
   */
  forgetBranding();
  forgetTenantHosts();

  return NextResponse.json({ tenant });
}
