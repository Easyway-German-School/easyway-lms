/**
 * The self-hosted replacement for Vercel Cron hitting /api/cron/tick and
 * /api/cron/tick-fast. Same jobs, same lanes, same failure alerts — imported
 * straight from src/lib/cron-jobs.ts and cron-lanes.ts, so there is exactly
 * one definition of what each job does, whichever front door runs it.
 *
 * This process is NOT a Next.js request: there is no HTTP layer, no
 * CRON_SECRET check (the box this runs on is the trusted caller — gate
 * access with firewall/SSH, not a bearer header), and no serverless
 * timeout — a job can run as long as it needs to.
 *
 * Usage (see deploy/cron-worker/README.md for the server-side crontab):
 *   tsx --tsconfig tsconfig.json --env-file=.env.production scripts/standalone-cron.ts tick
 *   tsx --tsconfig tsconfig.json --env-file=.env.production scripts/standalone-cron.ts tick-fast
 *   tsx --tsconfig tsconfig.json --env-file=.env.production scripts/standalone-cron.ts tick --lane=ai
 *
 * Exit code is 0 only if every job that ran succeeded — cron's own failure
 * email (MAILTO in the crontab) is the backstop under the in-app alert, for
 * the day the in-app alert itself can't fire (e.g. the DB is unreachable).
 */
import { runUnscoped } from "../src/lib/tenant/context";
import { CRON_PLAN, TICK_BUDGET_MS, runTick } from "../src/lib/cron-lanes";
import { buildDailyCronJobs, notifyFailedCronJobs, runFastCronJobs } from "../src/lib/cron-jobs";

async function runDailyTick(onlyLane?: string) {
  const jobs = buildDailyCronJobs();

  if (onlyLane && !CRON_PLAN.lanes.some((lane) => lane.name === onlyLane)) {
    console.error(`Unknown lane "${onlyLane}". Known lanes: ${CRON_PLAN.lanes.map((lane) => lane.name).join(", ")}`);
    process.exit(2);
  }

  const { results, lanes } = await runUnscoped(
    "the self-hosted cron worker runs every periodic job for every tenant",
    () =>
      runTick({
        jobs,
        only: onlyLane,
        budgetMs: TICK_BUDGET_MS,
        onError: async (job, error) => {
          console.error(`Cron job ${job} failed:`, error);
          try {
            const { captureError } = await import("../src/lib/capture-error");
            await captureError("cron", error, { job });
          } catch {
            // Best-effort, same as the Vercel route.
          }
        },
      }),
  );

  const failed = results.filter((result) => !result.ok);
  await notifyFailedCronJobs(failed);

  console.log(JSON.stringify({ ok: failed.length === 0, ran: results.length, results, lanes }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

async function runFastTick() {
  const result = await runUnscoped("the self-hosted fast-cron worker drains the email queue across every tenant", () =>
    runFastCronJobs(),
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const laneArg = rest.find((arg) => arg.startsWith("--lane="));
  const lane = laneArg?.slice("--lane=".length);

  if (mode === "tick") return runDailyTick(lane);
  if (mode === "tick-fast") return runFastTick();

  console.error('Usage: standalone-cron.ts <tick|tick-fast> [--lane=<name>]');
  process.exit(2);
}

main().catch((error) => {
  console.error("standalone-cron crashed:", error);
  process.exit(1);
});
