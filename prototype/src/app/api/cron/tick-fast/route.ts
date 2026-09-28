/**
 * A second, small cron: drains the email queue every few minutes.
 *
 * WHY THIS EXISTS, SEPARATE FROM /api/cron/tick. That dispatcher runs ~35
 * jobs — digests, nudges, transcription, an AI pass over new materials — and
 * is deliberately daily, because most of those jobs are "once a day" or
 * "once a week" by design. It cannot simply be pointed at a 5-minute
 * schedule: transcription and the material-AI pass are the heaviest things
 * in this codebase, and running them every five minutes would multiply their
 * model-call cost and memory pressure for no benefit, since they were never
 * meant to fire that often.
 *
 * But `queueEmail`'s post-response "kick" (see email-queue.ts) is
 * best-effort — it only runs if the serverless function is still alive to
 * execute it, and on a quiet period it can sit frozen for the better part of
 * an hour before some unrelated request happens to revive it. Measured in
 * production 2026-09-27: a payment confirmation and the new enrolment-letter
 * email both sat "queued" for 56 minutes before finally sending, with the
 * daily cron as the only guaranteed backstop. A payment receipt — or the
 * enrolment letter — arriving up to a day late is a bad first impression a
 * whole extra dispatcher run is not worth risking to fix.
 *
 * So this is deliberately narrow: just the mail queue, nothing else. Cheap
 * enough to run every 5 minutes on the Pro plan without competing for the
 * box's memory or the AI budget the other jobs spend.
 */

import { NextRequest, NextResponse } from "next/server";
import { withUnscoped } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleGET(request: NextRequest) {
  // Same secret, same check as /api/cron/tick — Vercel signs every cron
  // request on the project with this one header, whichever path it hits.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { drainQueue } = await import("@/lib/email-queue");
    const result = await drainQueue(50);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("tick-fast: email drain failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const GET = withUnscoped(
  "the fast cron drains the email queue across every tenant",
  handleGET,
);
