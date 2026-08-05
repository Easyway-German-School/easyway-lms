# Deploying to Vercel

Written 2026-08-04, for the first production deploy.

The repo already carries `vercel.json` (framework, the daily cron, and the four
routes that need more than 10s). Nothing about the build needs changing. What
follows is environment and verification.

---

## 1. Import the project

Vercel → **Add New → Project** → import `Easyway-German-School/easyway-lms`.

**Root Directory must be `prototype`.** The Next app is not at the repo root, and
this is the single most common way this import goes wrong — Vercel will report
"No Next.js version detected" if it is left at the default.

Everything else is detected: build command `npm run build` (which runs
`prisma generate` first), output `.next`, install `npm install`.

---

## 2. Environment variables

Copy from `.env.local`, **with the four corrections below**. Set them for
Production and Preview both, or preview deploys will fail in ways that look
like code faults.

### Must change from what is in `.env.local`

| Variable | Local value | What it must be on Vercel |
|---|---|---|
| `NEXTAUTH_URL` | `http://localhost:3000` | The deployment URL, e.g. `https://easyway-lms.vercel.app`. **Sign-in is broken until this is right** — every callback redirects to localhost. |
| `NEXT_PUBLIC_APP_URL` | unset | Same URL. Used to make links in emails absolute. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | **Do not set it.** There is no Ollama in a serverless container. `ai.ts` guards against it, but it is dead weight and misleads whoever reads the dashboard next. |
| `ANTHROPIC_API_KEY` | set, **unfunded** | See "The assistant" below. Either fund the account or leave this unset. |

### Copy across unchanged

`DATABASE_URL`, `DIRECT_DATABASE_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`,
`PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`,
`STORAGE_S3_*` (bucket, region, endpoint, access key, secret),
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

### Deliberately left empty

`STORAGE_PUBLIC_BASE_URL` — empty is the safe default and is not an oversight.
It makes uploads serve through `/api/files/<key>`, behind the session check.
These are student photographs and passport scans; a public bucket makes them
readable to anyone who can guess `<timestamp>-passport.jpg`. Only set this for a
bucket you are content to have world-readable.

`MFA_ENCRYPTION_KEY` — falls back to `NEXTAUTH_SECRET`. Setting it properly is
better long-term (rotating `NEXTAUTH_SECRET` currently invalidates every 2FA
enrolment), but it is not a blocker.

---

## 3. The database

The schema is **already pushed to Neon** — `NotificationSetting` and
`EmailMessage.identity` are live. Nothing to run at deploy time.

`npm run build` does **not** touch the database (only `prisma generate`), so a
deploy cannot migrate anything by surprise. When the schema changes in future,
run `npm run db:push` from a machine with `.env.local`, before deploying.

Never run `prisma migrate dev` against this database. It offers to reset.

---

## 4. After the first deploy — verification order

Do these in order. Each one depends on the one above it.

1. **Sign-in.** Open `/auth/signin`, log in as a student. If you land back on a
   localhost URL, `NEXTAUTH_URL` is wrong.
2. **Admin sign-in.** `/auth/admin` — a different door, and the one your
   sub-admins use. `/admin/staff` states this on the page.
3. **A DB-backed page.** `/admin/students`. First load after idle may be slow —
   see "Neon" below.
4. **The calendar.** Open a paid student's `/calendar`. Confirm both months of
   their batch show the *same* weekday pattern. That is the schedule fix.
5. **Payments.** Point the Paystack webhook at
   `https://<your-domain>/api/payments/webhook` in the Paystack dashboard. Run a
   test transaction. A payment that succeeds but leaves the student locked means
   the webhook is not arriving.
6. **The cron.** `vercel.json` runs `/api/cron/tick` daily at 06:00 UTC. Check
   Vercel → Deployments → Crons after the first firing. It drains the email
   queue, sends reminders, and rolls the schedule.
7. **Email.** Expect *nothing to send* until the transport is fixed — see below.
   `/admin/notification-settings` shows an amber banner saying so.

---

## 5. Three things that will not work on day one

These are known, not surprises. Each is a decision, not a bug.

### Email — cannot send

Tested 2026-08-04: `535 Authentication Failed` on `smtp.zoho.com:465`,
`smtp.zoho.eu:465` and `:587`. Zoho's Forever Free plan does not include SMTP.

Nothing is lost meanwhile. `notify()` still writes the in-app bell and push, and
emailed copies queue in `EmailMessage` with widening backoff. The moment a
working sender is configured, the backlog flushes on the next cron tick.

Cheapest fix — **Brevo**, free forever, 300/day:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<brevo login>
SMTP_PASS=<brevo SMTP key>
EMAIL_PROVIDER=            # must be blank, or the zoho preset overrides the host
```

Then add Brevo's SPF and DKIM records to `easywaylanguageschool.com`, or the
mail lands in spam. The two-sender setup (`support@` / `donotreply@`) needs no
change — that is a `From:` header per message, not a plan feature — but the
domain must be verified with the provider before the second address is accepted.

**Before paying for anything**, check one thing: `SMTP_PASS` is 12 characters and
Zoho app-specific passwords are 16. `535` means both "wrong password" and "no
SMTP on this plan". If that password came from the account rather than
**Settings → Security → App Passwords**, regenerate it and retest first.

### The assistant — Ollama cannot run on Vercel

Ollama is a server on a machine. `localhost:11434` inside a serverless function
is the function's own container, which has no Ollama and never will.

`ai.ts` already detects this (`isUnreachableLocalUrl` checks `process.env.VERCEL`)
and falls through. But `assistant-brain.ts` picks its provider differently:

```ts
brainProvider() { return hasHostedBrain() ? "claude" : "ollama"; }
```

No local guard, no funding check. So if `ANTHROPIC_API_KEY` is present it picks
Claude — and that key currently returns:

```
HTTP 400 — Your credit balance is too low to access the Anthropic API.
```

Which means the admin assistant would be **broken, not degraded**. Pick one:

- **Leave `ANTHROPIC_API_KEY` unset on Vercel** — the assistant reports "not
  reachable" honestly. No code change, costs nothing. Best for a test URL.
- **Fund the Anthropic account** (~$5 minimum) — the assistant works properly,
  including confirmed actions.
- **Tunnel to the office machine** — set `OLLAMA_BASE_URL` to an ngrok or
  Cloudflare tunnel. Works, but only while that machine is on.

### Neon — cold starts

Neon's free tier suspends the compute after ~5 minutes idle. The first request
after that pays a wake-up of a few seconds, and can fail outright — this
happened during testing today.

**You do not need to keep it awake manually**, and pinging it on a schedule
mostly burns your compute-hours allowance. Better options, in order:

1. **Do nothing.** Real traffic keeps it warm. A school with students logging in
   through the day rarely idles long enough to suspend.
2. The daily cron at 06:00 already wakes it before the office opens.
3. If cold starts prove annoying, Neon's paid tier removes suspend entirely.
   Raising the free tier's suspend timeout in the Neon console is the middle
   option.

The failure looks like `Can't reach database server at ep-...neon.tech:5432`. If
you see it once on the first hit of the morning and not again, that is this and
not a fault.

---

## 6. Custom domain

Vercel → Project → Settings → Domains → add `lms.easywaylanguageschool.com` (or
whichever). Then **update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to match and
redeploy** — they are baked per deployment, and auth breaks quietly if the
domain changes underneath them.
