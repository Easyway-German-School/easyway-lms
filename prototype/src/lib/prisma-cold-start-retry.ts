import { Prisma } from "@prisma/client";

/**
 * Turns a Neon cold start into extra latency instead of a failed request.
 *
 * Neon suspends this database's compute after a few minutes of no traffic —
 * see [[project-prisma-migrations]] and [[project-vercel-deploy-state]] in
 * project memory. The FIRST query after that hits a compute that has not
 * finished waking up and fails with P1001, "Can't reach database server".
 * Every route in the app was written assuming a reachable database, so that
 * error surfaces as a 500 to whoever's request happened to be first — which,
 * on a school portal nobody pings on a schedule, is a real student opening
 * the app after it has sat idle overnight.
 *
 * THE FIX IS NOT A KEEP-ALIVE PING. That was considered and rejected here
 * before (see project memory: "Do NOT ping it on a schedule — that burns the
 * compute allowance") — a ping every few minutes would exhaust the plan's
 * monthly compute-hour allowance far faster than real traffic does, and
 * running OUT of allowance suspends the project outright, which is a strictly
 * worse and longer outage than a few seconds of wake-up latency. The actual
 * permanent fix for zero wake-up latency is upgrading the Neon plan and
 * disabling autosuspend, which is a billing decision for a human to make, not
 * something this code can do.
 *
 * What this DOES fix, for free, in code: P1001 specifically means the
 * connection was never established — no command reached the server, so
 * retrying is always safe, including for writes. A short retry with backoff
 * absorbs Neon's few-second wake-up window, so the student who opens the app
 * first sees it load a little slower rather than sees an error page.
 */

const isColdStart = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P1001") return true;
  // Some paths (see prisma-guard.ts wrapping a raw query) rethrow as a plain
  // Error while preserving the original message — matched on text as a
  // fallback so those do not slip past the retry uncaught.
  if (error instanceof Error && /Can't reach database server/i.test(error.message)) return true;
  return false;
};

/**
 * Three retries, still short in total — a real cold start wakes in a few
 * seconds, and a genuinely dead database should still fail fast rather than
 * hang the request for a long time.
 *
 * Was [500, 1500] (2s of headroom). A tutor's photo save on the admin screen
 * was lost outright — the update reached the server, hit a slower-than-usual
 * wake-up, exhausted both retries, and came back as a 500 with nothing
 * written. The bucket had the freshly uploaded file the whole time; only the
 * database row never moved. Extending the window rather than adding a third
 * short delay, since the failure mode was "not quite enough time", not "the
 * retries fire too rarely".
 */
const DELAYS_MS = [500, 1500, 3000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createColdStartRetryExtension() {
  return Prisma.defineExtension({
    name: "cold-start-retry",
    query: {
      $allOperations: async ({ query, args }) => {
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            return await query(args);
          } catch (error) {
            if (attempt >= DELAYS_MS.length || !isColdStart(error)) throw error;
            await sleep(DELAYS_MS[attempt]);
            attempt += 1;
          }
        }
      },
    },
  });
}
