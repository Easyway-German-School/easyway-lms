import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { METERS, PLACEHOLDER_RATES_KOBO, type MeterName } from "@/lib/usage/meter";

export const dynamic = "force-dynamic";

/**
 * What this school has spent, and on what.
 *
 * Everything here reads through the tenant-scoped client, so a school sees its
 * own figures and there is no way to write this route that returns anybody
 * else's — the filter is underneath the query rather than in it.
 *
 * The shape of the answer is the argument for the pricing. A bill that says
 * "₦48,000, platform fee" is a bill nobody can check. A bill that says which
 * meter, how many units, and at what rate is one a bursar can verify against
 * their own term — and being checkable is most of what makes metered billing
 * acceptable to a customer who has been burned by a SaaS invoice before.
 */
export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: "This account is not attached to a school." },
      { status: 400 },
    );
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [credit, thisMonth, daily, statement, tenant] = await Promise.all([
    prisma.tenantCredit.findFirst({
      where: { tenantId },
      select: { balanceKobo: true, lowBalanceKobo: true, graceKobo: true },
    }),
    prisma.usageDaily.groupBy({
      by: ["meter"],
      where: { day: { gte: monthStart } },
      _sum: { quantity: true, costKobo: true },
    }),
    prisma.usageDaily.findMany({
      where: { day: { gte: thirtyDaysAgo } },
      orderBy: { day: "asc" },
      select: { day: true, meter: true, quantity: true, costKobo: true },
    }),
    prisma.creditTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        kind: true,
        amountKobo: true,
        balanceAfterKobo: true,
        reference: true,
        note: true,
        createdAt: true,
      },
    }),
    prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true, plan: true, trialEndsAt: true },
    }),
  ]);

  const lines = thisMonth
    .map((row) => {
      const meter = row.meter as MeterName;
      return {
        meter,
        label: METERS[meter]?.label ?? meter,
        unit: METERS[meter]?.unit ?? "unit",
        per: METERS[meter]?.per ?? 1,
        rateKobo: PLACEHOLDER_RATES_KOBO[meter] ?? 0,
        quantity: row._sum.quantity ?? 0,
        costKobo: row._sum.costKobo ?? 0,
      };
    })
    .sort((a, b) => b.costKobo - a.costKobo);

  const monthCostKobo = lines.reduce((total, line) => total + line.costKobo, 0);

  /**
   * Days of runway at the last thirty days' burn.
   *
   * The number a school actually wants — "when do I next have to think about
   * this" — rather than a balance they would have to divide themselves. Null
   * rather than Infinity when nothing has been spent, so the UI can say "no
   * usage yet" instead of printing a symbol.
   */
  const thirtyDayCost = daily.reduce((total, row) => total + row.costKobo, 0);
  const dailyBurnKobo = thirtyDayCost / 30;
  const balance = Number(credit?.balanceKobo ?? 0);
  const runwayDays = dailyBurnKobo > 0 ? Math.floor(balance / dailyBurnKobo) : null;

  return NextResponse.json({
    tenant,
    credit: {
      balanceKobo: String(credit?.balanceKobo ?? 0),
      lowBalanceKobo: String(credit?.lowBalanceKobo ?? 0),
      graceKobo: String(credit?.graceKobo ?? 0),
      runwayDays,
    },
    month: { from: monthStart.toISOString().slice(0, 10), costKobo: monthCostKobo, lines },
    daily: daily.map((row) => ({ ...row, day: row.day.toISOString().slice(0, 10) })),
    statement: statement.map((row) => ({
      ...row,
      amountKobo: row.amountKobo.toString(),
      balanceAfterKobo: row.balanceAfterKobo.toString(),
    })),
    /**
     * Stated in the payload rather than only in the UI, so that anything else
     * consuming this — a partner dashboard, a support script — carries the
     * warning too.
     */
    ratesArePlaceholders: true,
  });
}
