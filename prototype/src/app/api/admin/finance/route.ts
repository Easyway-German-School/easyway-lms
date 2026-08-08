import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  // Aggregate basic finance metrics
  const completed = await prisma.payment.aggregate({ where: { status: "completed" }, _sum: { amount: true }, _count: { id: true } });
  const pending = await prisma.payment.aggregate({ where: { status: "pending" }, _sum: { amount: true }, _count: { id: true } });
  const failed = await prisma.payment.aggregate({ where: { status: "failed" }, _sum: { amount: true }, _count: { id: true } });

  const invoices = await prisma.invoice.aggregate({ _sum: { totalAmount: true }, _count: { id: true } });

  const totalPayments = (completed._sum.amount || 0) + (pending._sum.amount || 0) + (failed._sum.amount || 0);
  const totalRevenue = completed._sum.amount || 0;
  const totalInvoices = invoices._count.id || 0;
  const totalInvoicedAmount = invoices._sum.totalAmount || 0;
  const outstanding = Math.max(0, (totalInvoicedAmount || 0) - (completed._sum.amount || 0));

  const byMethod = await prisma.payment.groupBy({
    by: ["method"],
    _sum: { amount: true },
  });

  return NextResponse.json({
    totalRevenue,
    totalPaymentsCount: completed._count.id || 0,
    pendingCount: pending._count.id || 0,
    failedCount: failed._count.id || 0,
    totalPayments,
    totalInvoices,
    totalInvoicedAmount,
    outstanding,
    byMethod,
  });
}
