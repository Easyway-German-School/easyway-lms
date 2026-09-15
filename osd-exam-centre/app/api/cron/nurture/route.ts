import { NextRequest, NextResponse } from "next/server";
import { runNurtureSweep } from "@/lib/nurture";
import { jsonRoute } from "@/lib/api-route";
import { secureCompare } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * Point Vercel Cron (or any scheduler) at this once a day with
 * Authorization: Bearer $CRON_SECRET. jsonRoute's 500-on-throw is what turns
 * a failed sweep into a red line in Vercel's cron log instead of a silent
 * green one.
 */
export const GET = jsonRoute(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization") ?? "";
  if (!secret || !secureCompare(provided, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runNurtureSweep();
  return NextResponse.json({ ok: true, ...result });
});
