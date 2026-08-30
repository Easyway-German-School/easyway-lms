import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/lib/platform";
import { createTenantOwner, listTenantOwners } from "@/lib/platform-owner";

export const dynamic = "force-dynamic";

/**
 * A school's administrator account(s).
 *
 * Onboarding a tenant creates no users, so a freshly-created school is one
 * nobody can sign into. This is where an operator names the school's owner —
 * a full `super` admin, scoped to that tenant, sent a set-password link.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const owners = await listTenantOwners(tenantId);
  return NextResponse.json({ owners });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const body = await request.json().catch(() => null);

  const result = await createTenantOwner(tenantId, {
    name: String(body?.name ?? ""),
    email: String(body?.email ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    { owner: result.owner, setupUrl: result.setupUrl },
    { status: 201 },
  );
}
