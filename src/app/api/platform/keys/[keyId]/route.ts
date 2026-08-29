import { NextRequest, NextResponse } from "next/server";
import { guardedPrisma } from "@/lib/prisma";
import { requirePlatformOperator } from "@/lib/platform";

export const dynamic = "force-dynamic";

/**
 * Revoke a key.
 *
 * Marked rather than deleted. A deleted key leaves the calls it made
 * unattributable, and "which key was doing this, and when did we stop it" is
 * the first question in every incident involving a partner integration. It
 * also means revocation is reversible by hand if it was a mistake, which
 * deletion is not.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const { keyId } = await params;

  const existing = await guardedPrisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, revokedAt: true, prefix: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such key." }, { status: 404 });
  }
  if (existing.revokedAt) {
    // Already revoked is the desired state, not an error. Saying so plainly
    // means a double-click on the button is not a scary red message.
    return NextResponse.json({ ok: true, alreadyRevoked: true, revokedAt: existing.revokedAt });
  }

  const key = await guardedPrisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
    select: { id: true, prefix: true, revokedAt: true },
  });

  console.info(`[platform] ${gate.ctx.email} revoked API key ${key.prefix}`);

  return NextResponse.json({ ok: true, key });
}
