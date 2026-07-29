import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runPaymentWarnings } from "@/lib/payment-warnings";
import { adminHasCapability } from "@/lib/admin-roles";

/**
 * Sends escalating warnings to students whose tuition is outstanding, before
 * the access gate locks them out.
 *
 * Two ways in:
 *   - a scheduler, with `Authorization: Bearer $CRON_SECRET`
 *   - an admin with the payments capability, for a manual run or a dry run
 *
 * Safe to call repeatedly: each warning tier is recorded and never re-sent.
 */

export const dynamic = "force-dynamic";

async function authorize(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (expected && header === `Bearer ${expected}`) return true;

  const session = (await getServerSession(authOptions as any)) as any;
  if (session?.user?.id && (await adminHasCapability(session.user.id, "payments"))) return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Default to a dry run for GET so opening the URL in a browser can never
  // send anything; the scheduler POSTs.
  const dryRun = req.nextUrl.searchParams.get("send") !== "true";

  try {
    const result = await runPaymentWarnings({ dryRun });
    return NextResponse.json({ dryRun, ...result });
  } catch (error) {
    console.error("Payment warnings failed:", error);
    return NextResponse.json({ error: "Payment warning run failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaymentWarnings({ dryRun: false });
    return NextResponse.json({ dryRun: false, ...result });
  } catch (error) {
    console.error("Payment warnings failed:", error);
    return NextResponse.json({ error: "Payment warning run failed" }, { status: 500 });
  }
}
