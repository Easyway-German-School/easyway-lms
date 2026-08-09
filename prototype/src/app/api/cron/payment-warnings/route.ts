import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { runPaymentWarnings } from "@/lib/payment-warnings";
import { adminHasCapability } from "@/lib/admin-roles";
import { maybeUnscoped } from "@/lib/tenant/context";

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

/**
 * Which of the two callers this is. The scheduler warns every school on the
 * platform; an admin pressing the button warns their own students and nobody
 * else's.
 */
async function authorize(req: NextRequest): Promise<"scheduler" | "admin" | false> {
  const expected = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (expected && header === `Bearer ${expected}`) return "scheduler";

  const session = await requireAuthSession();
  if (!session) return false;
  if (session.user?.id && (await adminHasCapability(session.user.id, "payments"))) return "admin";

  return false;
}

export async function GET(req: NextRequest) {
  const caller = await authorize(req);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Default to a dry run for GET so opening the URL in a browser can never
  // send anything; the scheduler POSTs.
  const dryRun = req.nextUrl.searchParams.get("send") !== "true";

  try {
    const result = await maybeUnscoped(
      caller === "scheduler",
      "scheduled payment warnings run across every tenant",
      async () => await runPaymentWarnings({ dryRun }),
    );
    return NextResponse.json({ dryRun, ...result });
  } catch (error) {
    console.error("Payment warnings failed:", error);
    return NextResponse.json({ error: "Payment warning run failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const caller = await authorize(req);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await maybeUnscoped(
      caller === "scheduler",
      "scheduled payment warnings run across every tenant",
      async () => await runPaymentWarnings({ dryRun: false }),
    );
    return NextResponse.json({ dryRun: false, ...result });
  } catch (error) {
    console.error("Payment warnings failed:", error);
    return NextResponse.json({ error: "Payment warning run failed" }, { status: 500 });
  }
}
