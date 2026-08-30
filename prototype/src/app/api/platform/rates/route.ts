import { NextRequest, NextResponse } from "next/server";
import { requirePlatformOperator } from "@/lib/platform";
import { rateRows, saveRates } from "@/lib/usage/rates";
import type { MeterName } from "@/lib/usage/meter";

export const dynamic = "force-dynamic";

/**
 * The platform price list — one table, not per tenant.
 *
 * Every entry that has never been set shows as a placeholder. The nightly
 * rollup bills at whatever is here; a placeholder is a number nobody has
 * checked against a real provider invoice, and the console says so.
 */

export async function GET() {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ rates: await rateRows() });
}

export async function PATCH(request: NextRequest) {
  const gate = await requirePlatformOperator();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const rates = body?.rates;
  if (!rates || typeof rates !== "object") {
    return NextResponse.json({ error: "Expected { rates: { meter: kobo, … } }." }, { status: 400 });
  }

  const patch: Partial<Record<MeterName, number>> = {};
  for (const [k, v] of Object.entries(rates as Record<string, unknown>)) {
    if (v === null || v === "") {
      patch[k as MeterName] = undefined as unknown as number; // clear → back to placeholder
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `"${k}" must be a non-negative number of kobo.` }, { status: 400 });
      }
      patch[k as MeterName] = n;
    }
  }

  await saveRates(patch);
  return NextResponse.json({ rates: await rateRows() });
}
