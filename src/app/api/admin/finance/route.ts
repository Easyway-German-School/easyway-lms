import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForInvoice, tenantScopeForPayment } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "payments");
}

export async function GET(request: Request) {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;
  if (!await isAdmin(auth.session.user.id)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const paymentWhere = tenantScopeForPayment(auth.tenantId);
  const invoiceWhere = tenantScopeForInvoice(auth.tenantId);

  // Aggregate basic finance metrics
  const completed = await prisma.payment.aggregate({ where: { ...paymentWhere, status: "completed" }, _sum: { amount: true }, _count: { id: true } });
  const pending = await prisma.payment.aggregate({ where: { ...paymentWhere, status: "pending" }, _sum: { amount: true }, _count: { id: true } });
  const failed = await prisma.payment.aggregate({ where: { ...paymentWhere, status: "failed" }, _sum: { amount: true }, _count: { id: true } });

  const invoices = await prisma.invoice.aggregate({
    where: invoiceWhere,
    _sum: { totalAmount: true },
    _count: { id: true },
  });

  const totalPayments = (completed._sum.amount || 0) + (pending._sum.amount || 0) + (failed._sum.amount || 0);
  const totalRevenue = completed._sum.amount || 0;
  const totalInvoices = invoices._count.id || 0;
  const totalInvoicedAmount = invoices._sum.totalAmount || 0;
  const outstanding = Math.max(0, (totalInvoicedAmount || 0) - (completed._sum.amount || 0));

  const byMethod = await prisma.payment.groupBy({
    by: ["method"],
    where: paymentWhere,
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
