# Deploying push-server

Mirrors `deploy/cron-worker/`'s pattern. This box needs: the repo, Node,
`tsx`, this folder's env file, a systemd unit to keep it running, and nginx
+ TLS in front since browsers refuse plain `ws://` from an `https://` page.

## 1. Provision the box

A new, small, dedicated VPS — **not** the existing Linode DB boxes
(`139.162.159.191` primary, `139.162.150.61` replica). Those run only
Postgres + pgbouncer + backup/monitoring scripts today; adding a new
always-on, internet-facing WebSocket service risks resource contention with
live production Postgres for the sake of a small cost saving. Smallest
tier that runs Node comfortably (1GB/1CPU is plenty — this process holds
open sockets and runs light per-user queries on a timer, not heavy compute).
Ubuntu 24.04 to match the other boxes.

## 2. Get the code and dependencies onto it

```bash
git clone <this repo> easyway-lms
cd easyway-lms/prototype
npm ci
```

No build step — `tsx` runs `push-server/server.ts` directly.

## 3. Environment

Copy `.env.production.example` in this folder to `.env.production` on the
box, filled from the Vercel dashboard (see that file's own header for why
not `vercel env pull`). **`NEXTAUTH_SECRET` must be byte-for-byte identical
to the main app's Vercel value** — it is what verifies a browser's push
token; a mismatch fails silently (clients just never see "ready" and stay
on their HTTP poll), not loudly.

## 4. Test once, by hand, before trusting systemd

```bash
npx tsx push-server/server.ts
```

Should print `push-server listening on :8081, polling connected users every
10000ms` and then sit there. Ctrl-C to stop. If it exits immediately with
"NEXTAUTH_SECRET is not set", the env file wasn't loaded — `tsx` does not
read `.env.production` on its own; either export the vars first or add
`--env-file=.env.production` to the command (same flag `standalone-cron.ts`
uses).

## 5. Supervise it with systemd

Copy `push-server.service.example` to `/etc/systemd/system/push-server.service`
(drop the `.example`), fix `WorkingDirectory`/`EnvironmentFile` paths and the
deploy user, then:

```bash
systemctl daemon-reload
systemctl enable --now push-server
systemctl status push-server
journalctl -u push-server -f
```

## 6. TLS + reverse proxy

See `nginx-push-server.conf.example` — nginx terminates TLS, forwards to
`127.0.0.1:8081`. Use `sslip.io` if there's no real domain pointed at this
box yet (zero DNS setup; swap for a real subdomain later with no client
change beyond the env var below). `certbot --nginx -d <domain>` issues the
cert and rewrites nginx's config to add the TLS directives.

## 7. Point the app at it (the step that actually changes behavior)

Set `NEXT_PUBLIC_PUSH_SERVER_URL=wss://<domain>` in Vercel's **production**
environment, then get a rebuild live — this is a `NEXT_PUBLIC_*` var, baked
in at build time, so a plain env update changes nothing until the next
build runs. Per `[[feedback-vercel-redeploy-only-no-fresh-build]]`: go
through the normal git push → Vercel git-integration pipeline (preferred),
or `vercel redeploy <existing-deployment-url>` — **never** a fresh
`vercel --prod` build from a local checkout (has silently dropped pages
before).

## 8. Verify for real, not by assumption

Open the production site, DevTools → Network → WS. There should be exactly
one WebSocket connection to the push-server's domain, a `{"type":"ready"}`
message shortly after it opens, and `{"type":"update", ...}` messages every
~10s. In `PortalUpdates.tsx`/`useLiveClass.tsx` terms: once that's
confirmed, the HTTP poll backs off to its backstop interval (120s) instead
of its active one (8-20s depending on the route) — visible in Network as a
sudden drop in `/api/portal/updates` and `/api/live/state` request
frequency. Don't declare this done from the code alone; confirm the socket
and the backstop-backoff actually happened in a real browser against the
real production URL.

## What this does NOT cover

`/api/community/typing/feed` and `/api/live/recap` are deliberately not
part of this — typing needs materially faster delivery than this tick's
10s interval (a genuinely different, event-driven design, not built), and
recap is low-volume and bounded to one screen (not worth it). See the
scoping note referenced from `../../push-server/README.md`.
