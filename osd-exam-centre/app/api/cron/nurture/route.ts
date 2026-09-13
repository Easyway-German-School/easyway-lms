import { NextRequest, NextResponse } from "next/server";
import { runNurtureSweep } from "@/lib/nurture";

export const dynamic = "force-dynamic";

/** Point Vercel Cron (or any scheduler) at this once a day with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runNurtureSweep();
  return NextResponse.json({ ok: true, ...result });
}
