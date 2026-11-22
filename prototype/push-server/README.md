# Self-hosted push server

Replaces `/api/portal/updates` AND `/api/live/state` polling (the two
highest-volume routes in production — `/api/portal/updates` was 37K Vercel
invocations/day per Observability, 2026-11-15) with a real connection: one
process on a box we pay for directly, pushing to every signed-in browser
instead of each one asking every 8-20 seconds.

**Code built and tested; client side fully wired; this PROCESS is not yet
deployed anywhere.** The client (`PortalUpdates.tsx`, `push-client.ts`,
`portal-state.ts`, `useLiveClass.tsx`) always tries to connect — nothing
changes for real users until someone deliberately does both:

1. Runs this process somewhere reachable from the internet, behind TLS
   (wss://, not ws://).
2. Sets `NEXT_PUBLIC_PUSH_SERVER_URL` in the app's production environment
   and triggers a PRODUCTION BUILD (this is a `NEXT_PUBLIC_*` var — it is
   baked in at build time, not read at runtime; a plain env-var update with
   no rebuild does nothing). Per
   [[feedback-vercel-redeploy-only-no-fresh-build]]: that rebuild must go
   through the normal git push → Vercel git-integration pipeline, or
   `vercel redeploy <existing-deployment-url>` — never a fresh `vercel --prod`
   build from a local checkout.

Until both of those happen, `src/lib/client/push-client.ts`'s
`connectPushUpdates` is a true no-op (see the comment at the top of that
file) and every client behaves exactly as if none of this existed.

## Why this is a separate decision from building it

This opens a new network port on a box that also hosts the live Postgres
replica (or wherever it ends up running — see "Where to run it" below). A
cron worker that misbehaves delays a notification by a day; a push service
that misbehaves could mean every signed-in student loses live chat/bell
updates at once. That is a materially different risk than
[[project-vercel-cost-migration-cron-phase1]]'s cron work, so this gets its
own explicit go-ahead before going live, not an automatic "it's built so
let's flip it on."

## Design

- **Auth** (`src/lib/push-auth.ts`): the browser can't send its NextAuth
  session cookie to this server — different host/port, different cookie
  domain. Instead, a same-origin Next.js route
  (`/api/portal/push-token`) mints a short-lived (5 min) HMAC-signed token
  the browser then hands to this server on connect. Same signing scheme as
  `src/lib/recorder.ts`'s `signRecorderBody`, a different purpose string so
  the two can never be swapped for each other.
- **Role is looked up from the database at connect time, never trusted from
  the client.** A forged `role` claim in the client's own auth message must
  not be able to widen what it can see — only the signed `userId` is trusted,
  and the server fetches the real role itself.
- **One central tick, not one timer per connection** (`tick()` in
  `server.ts`): the whole point is to stop paying per-poll, not to move that
  same per-connection cost onto this box uncoordinated. Every `PUSH_POLL_INTERVAL_MS`
  (default 10s — matched to the "feels instant" bar the old 8-12s poll set,
  not tighter), one pass fans out to every currently-connected user in
  parallel; nobody with no open socket costs anything between ticks.
- **Shared query logic** (`src/lib/portal-updates.ts`, `src/lib/live-state.ts`):
  extracted from the Vercel routes so both front doors call the exact same
  functions, same as `src/lib/cron-jobs.ts` did for the cron migration — one
  definition, no drift risk, the actual query logic is reusable while the
  two front doors have different trust models.
- **Graceful degradation, not a hard cutover.** `push-client.ts` reconnects
  with backoff on any drop. `PortalUpdates.tsx` and `useLiveClass.tsx` both
  keep their existing HTTP poll as a backstop — backed off to a long interval
  once the push connection is confirmed healthy (`portal-state.ts`'s
  `usePushHealthy`), never disabled outright. A flaky mobile link losing the
  push connection degrades to "as slow as today", never "silently nothing".
- **Community unread** (`/api/community/unread`) is NOT answered by this
  server on its own timer — `loadPortalUpdates` already computes that total
  as part of its normal query, so it rides along on the same tick for free.
  `portal-state.ts`'s `publishUnread` is what four separate client pollers
  (the floating launcher, the Student/Lecturer/Admin shells) now read
  instead of calling that route themselves. The route itself is untouched
  and still answers correctly — nothing calls it from the client anymore,
  but nothing is broken if something still does.

## Running it

Same pattern as `deploy/cron-worker/`:

```bash
npx tsx push-server/server.ts
```

Needs from the environment: `DATABASE_URL` / `DIRECT_DATABASE_URL` (same
pair as the cron worker) and `NEXTAUTH_SECRET` (must be the EXACT same value
as the main app's — it verifies tokens the app minted). `PUSH_SERVER_PORT`
(default 8081) and `PUSH_POLL_INTERVAL_MS` (default 10000) are both
optional.

## Where to run it

**Recommendation: a new, small, dedicated box** (~$5-10/mo), not the
existing Linode DB boxes. `139.162.159.191` (primary) and `139.162.150.61`
(hot-standby replica) are confirmed to be running only Postgres + pgbouncer
+ backup/monitoring scripts today — no LMS clone, no cron worker, no push
process. Putting a new, public-facing, always-on network service on either
risks resource contention with live production Postgres for the sake of a
~$5/mo saving; not worth it. This has NOT been provisioned yet — it needs
either a Linode API token or a manually-created VPS + IP handed over.

A firewall rule limiting the port to the app's own egress IPs isn't possible
(Vercel's IPs aren't static, same reason `pg_hba.conf` is open on the DB
boxes) — this is a public-ish endpoint gated by the push-token signature,
not network position. TLS (wss://, not ws://) is required before this is
reachable from a real browser on an https:// page — mixed content is
blocked by every browser. Neither the box nor the TLS setup exists yet.

## What's NOT built yet

- Provisioning the actual box this runs on.
- TLS / a reverse proxy (nginx + certbot via sslip.io, matching the pattern
  used elsewhere in this project) in front of the raw `ws://` port.
- Running this as a supervised process (systemd unit or equivalent) so it
  restarts on crash/reboot — `npx tsx push-server/server.ts` run by hand
  does not survive either.
- Setting `NEXT_PUBLIC_PUSH_SERVER_URL` and getting the resulting rebuild
  live in production.
- Extending the same pattern to `/api/community/typing/feed` (needs a
  genuinely different, event-driven design — its required latency is
  faster than this tick's 10s interval) and `/api/live/recap` (low volume,
  bounded to one screen, not worth it) — scoped and deliberately NOT done,
  see the scoping note in chat history.

Related: [[project-vercel-cost-migration-cron-phase1]],
[[project-vercel-bill-oct2026-drivers]].
