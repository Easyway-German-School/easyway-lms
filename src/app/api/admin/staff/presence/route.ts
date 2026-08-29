import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export async function POST() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  await prisma.user.update({
    where: { id: gate.admin.userId },
    data: { adminLastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}