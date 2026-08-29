import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiOk } from "@/lib/api/response";
import { METERS, PLACEHOLDER_RATES_KOBO, type MeterName } from "@/lib/usage/meter";

export const dynamic = "force-dynamic";

/**
 * What this school is being charged, over the API.
 *
 * Worth being an endpoint rather than only a page. A customer who can pull
 * their own usage into their own finance system can check the invoice without
 * asking us, and metered billing that cannot be independently checked is
 * metered billing that eventually gets disputed.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "usage:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const from = params.get("from")
    ? new Date(params.get("from")!)
    : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  const [daily, credit] = await Promise.all([
    prisma.usageDaily.findMany({
      where: { day: { gte: from, lte: to } },
      orderBy: { day: "asc" },
      select: { day: true, meter: true, quantity: true, costKobo: true },
    }),
    prisma.tenantCredit.findFirst({ select: { balanceKobo: true } }),
  ]);

  const byMeter = new Map<string, { quantity: number; costKobo: number }>();
  for (const row of daily) {
    const current = byMeter.get(row.meter) ?? { quantity: 0, costKobo: 0 };
    current.quantity += row.quantity;
    current.costKobo += row.costKobo;
    byMeter.set(row.meter, current);
  }

  return apiOk({
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    /** A string, because a large balance in kobo loses precision as a JSON number. */
    balanceKobo: String(credit?.balanceKobo ?? 0),
    totalKobo: [...byMeter.values()].reduce((sum, meter) => sum + meter.costKobo, 0),
    meters: [...byMeter.entries()].map(([meter, totals]) => ({
      meter,
      label: METERS[meter as MeterName]?.label ?? meter,
      unit: METERS[meter as MeterName]?.unit ?? "unit",
      per: METERS[meter as MeterName]?.per ?? 1,
      rateKobo: PLACEHOLDER_RATES_KOBO[meter as MeterName] ?? 0,
      ...totals,
    })),
    days: daily.map((row) => ({ ...row, day: row.day.toISOString().slice(0, 10) })),
    /** Stated in the payload so a partner's own finance system carries it too. */
    ratesArePlaceholders: true,
  });
}
