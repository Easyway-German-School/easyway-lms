import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, CAPABILITIES, type Capability } from "@/lib/admin-roles";
import { generateAdminApiKey } from "@/lib/admin-api-key";

export const dynamic = "force-dynamic";

/**
 * Keys for calling /api/admin/* without a browser session (see AdminApiKey in
 * schema.prisma and requireCapability in src/lib/admin-roles.ts). Behind
 * `security`, the same door as the audit trail and MFA — a credential that
 * can reach the rest of the admin surface is exactly what that door exists
 * to gate.
 *
 * Scoped to the signed-in admin's own keys. There is no cross-admin list —
 * a key borrows its creator's identity, so it is that admin's business alone.
 */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const keys = await prisma.adminApiKey.findMany({
    where: { userId: gate.admin.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      capabilities: true,
      lastUsedAt: true,
      revokedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ keys, capabilities: CAPABILITIES });
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim() || "Untitled key";
  const requested: string[] = Array.isArray(body?.capabilities) ? body.capabilities.map(String) : [];

  const unknown = requested.filter((c) => !(CAPABILITIES as readonly string[]).includes(c));
  if (unknown.length) {
    return NextResponse.json(
      { error: `Unknown capability(ies): ${unknown.join(", ")}`, allowed: CAPABILITIES },
      { status: 400 },
    );
  }

  /**
   * Capped at what the creating admin can themselves reach right now. A key
   * can never carry more than its creator — including if their own access is
   * later narrowed, since this reads `gate.admin.can`, not the raw request.
   */
  const capabilities = (requested as Capability[]).filter((c) => gate.admin.can(c));
  if (capabilities.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one capability this key should be able to reach." },
      { status: 400 },
    );
  }

  let expiresAt: Date | null = null;
  const expiresInDays = Number(body?.expiresInDays);
  if (Number.isFinite(expiresInDays) && expiresInDays > 0) {
    expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  const generated = generateAdminApiKey();

  const key = await prisma.adminApiKey.create({
    data: {
      userId: gate.admin.userId,
      tenantId: gate.session.user.tenantId ?? null,
      name,
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      capabilities: capabilities.join(","),
      expiresAt,
    },
    select: { id: true, name: true, prefix: true, capabilities: true, createdAt: true, expiresAt: true },
  });

  return NextResponse.json(
    {
      key,
      /**
       * The only time this value exists anywhere — stored as a hash, so it
       * cannot be shown again, same contract as the partner API's keys.
       */
      plaintext: generated.plaintext,
      warning: "Copy this now. It is stored as a hash and cannot be shown again.",
    },
    { status: 201 },
  );
}
