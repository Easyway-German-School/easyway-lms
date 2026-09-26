import { NextRequest, NextResponse } from "next/server";
import { runJourneySweep } from "@/lib/journey";
import { jsonRoute } from "@/lib/api-route";
import { secureCompare } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";
// The sweep renders PDFs and sends email one candidate at a time.
export const maxDuration = 60;

/**
 * Point Vercel Cron (or any scheduler) at this once a day with
 * Authorization: Bearer $CRON_SECRET. The path keeps its old name ("nurture")
 * so the already-registered cron entry keeps working; what it runs is now the
 * whole candidate journey (lib/journey.ts), of which the prep-class note is
 * one step. jsonRoute's 500-on-throw is what turns a failed sweep into a red
 * line in Vercel's cron log instead of a silent green one.
 */
export const GET = jsonRoute(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization") ?? "";
  if (!secret || !secureCompare(provided, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runJourneySweep();
  return NextResponse.json({ ok: true, ...result });
});
