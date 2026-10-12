import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/** Revoke one of the signed-in admin's own keys. There is no un-revoke. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const key = await prisma.adminApiKey.findUnique({
    where: { id },
    select: { userId: true, revokedAt: true },
  });
  if (!key || key.userId !== gate.admin.userId) {
    return NextResponse.json({ error: "No such key." }, { status: 404 });
  }

  if (!key.revokedAt) {
    await prisma.adminApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  return NextResponse.json({ ok: true });
}
