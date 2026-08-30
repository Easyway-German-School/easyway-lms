import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";

export const dynamic = "force-dynamic";

/**
 * Is this school's domain actually pointed at us yet?
 *
 * The check is end-to-end rather than a DNS lookup: it asks the domain itself
 * for `/api/tenant/branding`, which every deployment of this app answers and
 * which resolves the tenant purely from the hostname it arrived on. Three
 * outcomes:
 *
 *   - the request fails            → DNS is not pointed here yet
 *   - it answers, wrong school     → pointed here, but `Tenant.domain` in our
 *                                    database does not match this host
 *   - it answers, right school     → live
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const tenant = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, brandName: true, domain: true },
  });
  if (!tenant) return NextResponse.json({ error: "No such school." }, { status: 404 });

  const domain = tenant.domain?.trim().toLowerCase();
  const cnameTarget = "cname.vercel-dns.com";

  if (!domain) {
    return NextResponse.json({ state: "unset", cnameTarget });
  }

  const expected = (tenant.brandName?.trim() || tenant.name).trim();

  try {
    const res = await fetch(`https://${domain}/api/tenant/branding`, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json({ state: "unreachable", domain, cnameTarget, httpStatus: res.status });
    }
    const data = (await res.json().catch(() => null)) as { name?: string } | null;
    const servedName = data?.name?.trim() ?? "";
    const live = servedName.toLowerCase() === expected.toLowerCase();
    return NextResponse.json({
      state: live ? "live" : "wrong-tenant",
      domain,
      cnameTarget,
      servedName,
      expectedName: expected,
    });
  } catch {
    return NextResponse.json({ state: "unreachable", domain, cnameTarget });
  }
}
