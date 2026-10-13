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
 * So this is deliberately narrow: just the mail queue, nothing else.
 *
 * Schedule is every 15 minutes, not every 5 (the original 2026-09-28
 * version). A ping every 5 minutes never let Neon's compute fully
 * auto-suspend — the endpoint sat active around the clock instead of only
 * during real school traffic, and tripled the monthly bill within two
 * weeks. 15 minutes still beats the 56-minute stall this was built to fix,
 * while leaving enough idle time between runs for the database to actually
 * go back to sleep.
 *
 * 2026-10-11: one more job rides along, for the same cost reason above —
 * Mission Control's auto-resync (lib/auto-heal.ts) needs to run every few
 * minutes, and adding its own cron entry would wake Neon on a second,
 * independent schedule and risk the same billing mistake. It is cheap (one
 * indexed read of a handful of rows) and failure-isolated from the mail
 * drain below, so it shares this wake-up instead of getting its own.
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

  const [emailResult, autoHealResult] = await Promise.allSettled([
    (async () => {
      const { drainQueue } = await import("@/lib/email-queue");
      return drainQueue(50);
    })(),
    (async () => {
      const { runPortalResync } = await import("@/lib/auto-heal");
      return runPortalResync();
    })(),
  ]);

  if (emailResult.status === "rejected") console.error("tick-fast: email drain failed:", emailResult.reason);
  if (autoHealResult.status === "rejected") console.error("tick-fast: auto-heal failed:", autoHealResult.reason);

  return NextResponse.json({
    ok: emailResult.status === "fulfilled" && autoHealResult.status === "fulfilled",
    result: emailResult.status === "fulfilled" ? emailResult.value : { error: String(emailResult.reason) },
    autoHeal: autoHealResult.status === "fulfilled" ? autoHealResult.value : { error: String(autoHealResult.reason) },
  });
}

export const GET = withUnscoped(
  "the fast cron drains the email queue across every tenant",
  handleGET,
);
