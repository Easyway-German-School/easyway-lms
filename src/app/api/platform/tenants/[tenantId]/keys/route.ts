import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";
import { generateApiKey } from "@/lib/api/keys";

export const dynamic = "force-dynamic";

/**
 * A tenant's API keys.
 *
 * The secret half is not here and cannot be — only its sha256 was ever stored.
 * What is listed is the prefix, which is safe to log and to paste into a
 * support conversation, and which is the whole reason the format has one: a
 * partner reporting "our integration stopped working" can name the key without
 * sending us a live credential.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;

  const keys = await guardedPrisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      environment: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ keys });
}

/**
 * Every scope a key may be granted.
 *
 * An explicit list rather than free text. A typo in a scope string on a
 * free-text field produces a key that carries a grant nothing checks — which
 * fails safe against our routes and fails confusingly against the partner, who
 * has a key that says `student:read` and an API that wants `students:read`.
 */
const SCOPES = [
  "identity:read",
  "students:read",
  "students:write",
  "enrolments:read",
  "enrolments:write",
  "payments:read",
  "classes:read",
  "attendance:read",
  "attendance:write",
  "usage:read",
] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { tenantId } = await params;
  const tenant = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "No such school." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim() || "Untitled key";
  const environment = body?.environment === "live" ? "live" : "test";
  const requested: string[] = Array.isArray(body?.scopes) ? body.scopes.map(String) : [];

  const unknown = requested.filter((s) => !SCOPES.includes(s as (typeof SCOPES)[number]));
  if (unknown.length) {
    return NextResponse.json(
      { error: `Unknown scope(s): ${unknown.join(", ")}`, allowed: SCOPES },
      { status: 400 },
    );
  }

  /**
   * `identity:read` is always granted. It is what /v1/me needs, it discloses
   * nothing but the caller's own tenant name, and it is the first call every
   * integrator makes — a key that cannot answer "am I working?" makes the first
   * ten minutes of an integration a guessing game.
   */
  const scopes = Array.from(new Set(["identity:read", ...requested]));

  const generated = generateApiKey(environment);

  const key = await guardedPrisma.apiKey.create({
    data: {
      tenantId,
      name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      environment,
      scopes: scopes.join(","),
    },
    select: { id: true, name: true, prefix: true, environment: true, createdAt: true },
  });

  return NextResponse.json(
    {
      key,
      /**
       * The only time this value exists anywhere. Stored as a hash, so it
       * cannot be shown again, and saying so here rather than in the docs is
       * what stops somebody closing the dialog and asking us to look it up.
       */
      plaintext: generated.plaintext,
      warning: "Copy this now. It is stored as a hash and cannot be shown again.",
      scopes,
    },
    { status: 201 },
  );
}
