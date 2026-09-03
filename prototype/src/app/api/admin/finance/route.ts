import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isReceivedPayment, receivedPaymentFilter } from "@/lib/payment";
import { requireCapability } from "@/lib/admin-roles";
import { FINANCE_STUDENT_SELECT, computeAll, summariseReceivables } from "@/lib/finance/receivables";

export const dynamic = "force-dynamic";

const MONTHS_OF_TREND = 12;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Everything the finance workspace needs, in one request.
 *
 * What this replaced was four aggregates that did not describe the school. It
 * reported "outstanding" as invoiced-minus-collected, and the great majority of
 * students who owe tuition have never had an Invoice row raised — they enrolled
 * and did not pay, which is exactly the case an accountant opens this screen
 * for. So the figure was near zero on a school owed millions, and the
 * dashboard's own outstanding total (which does price every student off the fee
 * table) disagreed with it on the same afternoon.
 *
 * Outstanding is now priced off the fee table for every enrolled student, from
 * the same module the dashboard and the roster use, so the three screens cannot
 * quote three different numbers.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const trendStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_OF_TREND - 1), 1);

  const [students, payments, invoiceAgg, unpaidInvoices, recentPayments] = await Promise.all([
    prisma.student.findMany({
      where: branchId ? { branchId } : {},
      select: FINANCE_STUDENT_SELECT,
    }),
    // Every transaction in the trend window, whatever its state — the pending
    // and failed counts are part of what the accountant is checking, so they
    // are read here rather than in three more aggregate round trips.
    prisma.payment.findMany({
      where: { createdAt: { gte: trendStart } },
      select: { amount: true, status: true, method: true, createdAt: true },
    }),
    prisma.invoice.aggregate({ _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.invoice.count({ where: { status: { in: ["draft", "partial", "open", "unpaid"] } } }),
    prisma.payment.findMany({
      where: receivedPaymentFilter(),
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        amount: true,
        method: true,
        description: true,
        createdAt: true,
        student: {
          select: { id: true, branch: { select: { name: true } }, user: { select: { name: true, email: true } } },
        },
      },
    }),
  ]);

  const finance = computeAll(students, now);
  const summary = summariseReceivables(finance);

  /* ---- Cash actually received ------------------------------------------ */

  const completed = payments.filter((payment) => isReceivedPayment(payment.status));

  const trend = new Map<string, { key: string; label: string; amount: number; count: number }>();
  for (let index = MONTHS_OF_TREND - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    trend.set(monthKey(date), {
      key: monthKey(date),
      // Labelled off the same Date that produced the key. Re-parsing "2026-07"
      // as UTC and formatting it locally lands on 30 June anywhere behind UTC,
      // which labelled every bar a month early.
      label: date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      amount: 0,
      count: 0,
    });
  }

  let thisMonth = 0;
  let lastMonth = 0;
  for (const payment of completed) {
    const bucket = trend.get(monthKey(payment.createdAt));
    if (bucket) {
      bucket.amount += payment.amount;
      bucket.count += 1;
    }
    if (payment.createdAt >= startOfMonth) thisMonth += payment.amount;
    else if (payment.createdAt >= startOfLastMonth) lastMonth += payment.amount;
  }

  const byMethod = new Map<string, { method: string; amount: number; count: number }>();
  for (const payment of completed) {
    const method = payment.method || "unrecorded";
    const entry = byMethod.get(method) ?? { method, amount: 0, count: 0 };
    entry.amount += payment.amount;
    entry.count += 1;
    byMethod.set(method, entry);
  }

  const stateOf = (status: string) => {
    const rows = payments.filter((payment) => payment.status === status);
    return { count: rows.length, amount: rows.reduce((sum, row) => sum + row.amount, 0) };
  };

  return NextResponse.json({
    generatedAt: now.toISOString(),
    branchId,

    /* The book: what the school is owed and has taken, priced off the fee table. */
    book: {
      students: summary.students,
      expected: summary.expected,
      collected: summary.collected,
      outstanding: summary.outstanding,
      // Split by whether the machinery acts on it. Legacy arrears (levels passed
      // before the tuition ledger existed) are chased but never auto-locked.
      outstandingGoForward: summary.outstandingGoForward,
      outstandingLegacy: summary.outstandingLegacy,
      depositShortfall: summary.depositShortfall,
      collectionRate: summary.collectionRate,
      cohorts: summary.cohortCounts,
      lockedOut: summary.lockedOut,
      behindOnTuition: summary.behindOnTuition,
      owesPriorLevel: summary.owesPriorLevel,
    },

    /* Cash movement: what actually arrived, and when. */
    cash: {
      thisMonth,
      lastMonth,
      monthOnMonthPercent:
        lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null,
      trend: [...trend.values()],
      byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
      completed: stateOf("completed"),
      pending: stateOf("pending"),
      failed: stateOf("failed"),
      windowMonths: MONTHS_OF_TREND,
    },

    aging: summary.aging,
    byBranch: summary.byBranch,
    byLevel: summary.byLevel,

    /* Who to ring first. */
    topDebtors: finance
      .filter((row) => row.owed > 0)
      .sort((a, b) => b.owed - a.owed || b.daysEnrolled - a.daysEnrolled)
      .slice(0, 8),

    recentPayments: recentPayments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      description: payment.description,
      at: payment.createdAt.toISOString(),
      studentId: payment.student?.id ?? null,
      studentName: payment.student?.user?.name ?? payment.student?.user?.email ?? "Unknown",
      branch: payment.student?.branch?.name ?? "Unassigned",
    })),

    invoices: {
      count: invoiceAgg._count.id || 0,
      total: invoiceAgg._sum.totalAmount || 0,
      unsettled: unpaidInvoices,
    },
  });
}
