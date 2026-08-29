import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/** The refund queue — every request, newest first, optionally filtered by status. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const requests = await prisma.refundRequest.findMany({
    where: status && status !== "all" ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      student: { select: { studentCode: true, branch: { select: { name: true } }, level: true } },
      decidedBy: { select: { name: true } },
    },
  });

  const counts = await prisma.refundRequest.groupBy({ by: ["status"], _count: true });
  const countByStatus = Object.fromEntries(counts.map((row) => [row.status, row._count]));

  return NextResponse.json({
    requests: requests.map((row) => ({
      id: row.id,
      status: row.status,
      name: row.fullName,
      email: row.user.email,
      phone: row.phone,
      studentCode: row.student?.studentCode ?? null,
      branch: row.student?.branch?.name ?? null,
      level: row.student?.level ?? null,
      courseOrPackage: row.courseOrPackage,
      paymentReference: row.paymentReference,
      reason: row.reason,
      supportingDocs: row.supportingDocs,
      requestedAmount: row.requestedAmount,
      decisionAmount: row.decisionAmount,
      decisionNote: row.decisionNote,
      decidedByName: row.decidedBy?.name ?? null,
      acceptedTermsVersion: row.acceptedTermsVersion,
      acceptedTermsAt: row.acceptedTermsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
    })),
    countByStatus,
  });
}
