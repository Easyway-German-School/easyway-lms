import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/** Every acceptance on record, newest first — the "who has agreed to what" ledger. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const context = searchParams.get("context");
  const take = Math.min(200, Number(searchParams.get("take")) || 100);

  const acceptances = await prisma.termsAcceptance.findMany({
    where: context ? { context } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      user: { select: { name: true, email: true } },
      student: { select: { studentCode: true, branch: { select: { name: true } }, level: true } },
    },
  });

  const totalCount = await prisma.termsAcceptance.count();
  const signupCount = await prisma.termsAcceptance.count({ where: { context: "signup" } });
  const refundCount = await prisma.termsAcceptance.count({ where: { context: "refund" } });

  return NextResponse.json({
    acceptances: acceptances.map((row) => ({
      id: row.id,
      name: row.user.name,
      email: row.user.email,
      studentCode: row.student?.studentCode ?? null,
      branch: row.student?.branch?.name ?? null,
      level: row.student?.level ?? null,
      context: row.context,
      version: row.version,
      acceptedAt: row.createdAt.toISOString(),
      ip: row.ip,
    })),
    counts: { total: totalCount, signup: signupCount, refund: refundCount },
  });
}
