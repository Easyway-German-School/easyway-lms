import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { applyReprice, findChargesOutOfStep } from "@/lib/finance/reprice";

/**
 * Students whose tuition charge no longer matches the price list — and the
 * button that corrects them. See src/lib/finance/reprice.ts for the rules, and
 * for why nothing here happens automatically.
 *
 *   GET                        → open charges whose amount differs from the list
 *   POST { chargeIds: [...] }  → correct exactly those; the server recomputes
 *                                every target amount, the request never carries one
 */

export const dynamic = "force-dynamic";

/** One click should not be able to rewrite the whole school's ledger by accident. */
const MAX_PER_REQUEST = 200;

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await findChargesOutOfStep());
  } catch (error) {
    console.error("Failed to list charges that differ from the price list:", error);
    return NextResponse.json({ error: "Unable to load the charges" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json().catch(() => null);
    const chargeIds: string[] = Array.isArray(body?.chargeIds)
      ? body.chargeIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (!chargeIds.length) {
      return NextResponse.json({ error: "Pick at least one student to update." }, { status: 400 });
    }
    if (chargeIds.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        { error: `Update at most ${MAX_PER_REQUEST} students at a time.` },
        { status: 400 },
      );
    }

    const result = await applyReprice(chargeIds);

    if (result.updated.length) {
      await writeAudit(unguardedPrisma, {
        action: "tuitionChargesRepriced",
        model: "TuitionCharge",
        affectedCount: result.updated.length,
        severity: "notice",
        summary: `${result.updated.length} tuition charge${result.updated.length === 1 ? "" : "s"} re-priced to the price list: ${result.updated
          .slice(0, 20)
          .map((u) => `${u.studentName} ₦${u.from.toLocaleString("en-NG")} → ₦${u.to.toLocaleString("en-NG")}`)
          .join("; ")}${result.updated.length > 20 ? "; …" : ""}`,
        after: { chargeIds: result.updated.map((u) => u.chargeId) },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Failed to re-price charges:", error);
    return NextResponse.json({ error: "Unable to update those charges" }, { status: 500 });
  }
}
