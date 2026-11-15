# Self-hosted push server

Replaces `/api/portal/updates` polling (37K Vercel invocations/day — the
single highest-volume route in production per Vercel's Observability
dashboard, 2026-11-15) with a real connection: one process on a box we
already pay for, pushing to every signed-in browser instead of each one
asking every 8-12 seconds.

**Built, tested, NOT deployed, NOT wired into any client.** Nothing changes
for real users until someone deliberately does both:

1. Runs this process somewhere reachable from the internet.
2. Sets `NEXT_PUBLIC_PUSH_SERVER_URL` in the app's production environment.

Until both of those happen, `src/lib/client/push-client.ts` is inert — see
the comment at the top of that file. `PortalUpdates.tsx` has not been
touched; it still only polls.

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
- **Shared query logic** (`src/lib/portal-updates.ts`): extracted from the
  Vercel route so both front doors call the exact same function, same as
  `src/lib/cron-jobs.ts` did for the cron migration — one definition, no
  drift risk, the actual query logic is reusable while the two front doors
  have different trust models.
- **Graceful degradation, not a hard cutover.** `push-client.ts` reconnects
  with backoff on any drop. The plan (not yet built) is for `PortalUpdates.tsx`
  to keep its existing poll as a backstop even after this is wired in — a
  flaky mobile link losing the push connection should degrade to "as slow as
  today", never "silently nothing".

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

Not decided. Candidates:
- The existing Linode replica box (`139.162.150.61`) — already running the
  cron worker, zero new infra cost, but mixes a new user-facing network
  service onto a box that also hosts the hot-standby Postgres replica.
- A new, small, dedicated box — cleaner isolation, but a new recurring cost
  that hasn't been approved.

Either way: a firewall rule limiting the port to the app's own egress IPs
isn't possible (Vercel's IPs aren't static, same reason `pg_hba.conf` is
open on the DB boxes) — this is a public-ish endpoint gated by the
push-token signature, not network position. TLS (wss://, not ws://) is
required before this is reachable from a real browser on an https:// page
— mixed content is blocked by every browser. Neither the box choice nor the
TLS setup has been done.

## What's NOT built yet

- The actual integration into `PortalUpdates.tsx` (connect, merge pushed
  updates with the existing poll results, keep the poll as backstop).
- TLS / a reverse proxy in front of the raw `ws://` port.
- Deploying this anywhere.
- Extending the same pattern to the other high-volume polling routes
  (`/api/community/unread`, `/api/live/recap`, `/api/community/typing/feed`)
  — this only covers `/api/portal/updates`, the single biggest one.

Related: [[project-vercel-cost-migration-cron-phase1]],
[[project-vercel-bill-oct2026-drivers]].
