import { NextRequest, NextResponse, after } from "next/server";
import { kickClassNotes, runClassNotes } from "@/lib/class-notes-runner";

export const dynamic = "force-dynamic";
// The work runs in `after()`, which counts against this ceiling. 300s is the
// most the plan allows; the run budget below leaves room to respond and re-kick.
export const maxDuration = 300;

/** How long one link in the chain may work. Leaves ~60s of the 300 for the tail. */
const RUN_BUDGET_MS = 240_000;

/**
 * One link in the self-driving class-notes chain — see lib/class-notes-runner.ts.
 *
 * Answers 202 at once and does the work after the response, so whatever kicked
 * it (the end of a recorded class, the daily tick, the admin button, the
 * previous link) never waits on it. When a run made progress and more remains,
 * it kicks the next one; when it made none, the chain ends.
 *
 * Secret-authenticated like every other scheduled route (CRON_SECRET): it works
 * on every school's recordings, so it is not something a browser should reach.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;

  after(async () => {
    try {
      const summary = await runClassNotes({ budgetMs: RUN_BUDGET_MS });
      console.log("[class-notes] run", JSON.stringify(summary));
      if (summary.ran && summary.progressed && summary.remaining > 0) await kickClassNotes(origin);
    } catch (error) {
      console.error("[class-notes] run failed", error);
      try {
        const { captureError } = await import("@/lib/capture-error");
        await captureError("cron", error, { job: "class-notes" });
      } catch {
        /* the log line above is the record that matters */
      }
    }
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
