# Self-hosted cron worker

Runs `scripts/standalone-cron.ts` from a plain Linux box instead of Vercel
Cron hitting `/api/cron/tick` and `/api/cron/tick-fast`. Same job code, same
DB, same alerts — see `src/lib/cron-jobs.ts` for the shared registry both
front doors use.

This is phase 1 of moving heavy compute off Vercel: lowest risk first,
because this job has no user-facing surface — a late tick is unnoticed, a
down site is not.

## Why parallel-run first, not cut over immediately

Nearly every job in `CRON_PLAN` is already written to be idempotent
(dedupe-keyed per day/week — see the comments in `cron-jobs.ts`). That means
running this worker AND leaving Vercel's existing cron schedule turned on at
the same time for a few days is safe, not wasteful: whichever runs first does
the work, the second run finds nothing new to do. Use that window to confirm
this worker's output matches what Vercel was producing before touching
`vercel.json`.

## 1. Provision the box

One small VPS is enough — this job is not latency- or redundancy-sensitive
(a missed tick waits for the next one), so it does not need the two-server +
load-balancer setup planned for the later, user-facing phases.

- Same provider/region as the existing DB server (`139.162.159.191`) to keep
  the DB connection on a short, cheap hop.
- Smallest tier that runs Node comfortably — a 1GB/1CPU box is plenty; the
  heaviest single job (`class-transcription`) only kicks off work elsewhere
  (LiveKit/ffmpeg via `class-notes-runner`) rather than doing the ffmpeg pass
  on this box itself.
- Ubuntu 24.04 to match the DB boxes.

## 2. Get the code and dependencies onto it

```bash
git clone <this repo> easyway-lms
cd easyway-lms/prototype
npm ci
```

No `npm run build` needed — `tsx` runs the TypeScript directly, same as
every other `scripts/*.ts` in this repo.

## 3. Environment

Copy `.env.production.example` in this folder to `.env.production` on the
box and fill in every value **from the Vercel dashboard directly** (Settings
→ Environment Variables), not `vercel env pull` — vars marked Sensitive come
back as `[SENSITIVE]` over the CLI on this project (see
`DATABASE_URL`/`DIRECT_DATABASE_URL`, which already do this). The real
`DATABASE_URL`/`DIRECT_DATABASE_URL` pair is also saved at
`~/.secrets/easyway-db-connection.txt` on the main dev machine if that's
faster than the dashboard.

`CRON_SECRET` is not needed here — this process calls the job functions
directly, no HTTP, no bearer header. Leave the Vercel route's secret as-is;
it still gates the `/api/cron/*` routes for as long as they're reachable.

## 4. Test once, by hand, before trusting a schedule

```bash
npx tsx --tsconfig tsconfig.json --env-file=.env.production scripts/standalone-cron.ts tick-fast
```

Start with `tick-fast`, not `tick` — it only touches the mail queue and
portal auto-heal, so a mistake here is cheap to notice and cheap to undo.
Only move on to a manual `tick` run (and then the crontab below) once that
looks right.

## 5. Crontab

See `crontab.example` in this folder. Install with `crontab -e` as the
deploy user (not root, unless that's this box's convention already).

`MAILTO` in the crontab is the backstop under the in-app admin alert
(`notifyFailedCronJobs`) — if the DB itself is unreachable, the in-app alert
can't fire either, but cron's own failure mail still can.

## 6. Cutting Vercel's schedule off

Not yet — see "why parallel-run first" above. Once this worker has run clean
for several days, remove the `tick`/`tick-fast` entries from `vercel.json`'s
`crons` array (leave the routes themselves in place for now as a manual
fallback an admin could still hit directly with the bearer secret).
