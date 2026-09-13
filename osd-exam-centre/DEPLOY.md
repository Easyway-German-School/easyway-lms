# Deploying `osd-exam-centre`

A step-by-step checklist, in order. Nothing here can be done by an AI
session — each step needs an account, a payment, or a decision only Jason
can make. Skip a "before real candidates" step and the site still runs;
skip a "before it's usable at all" step and it won't start.

## 1. Domain (decide, don't need to buy anything)

Recommended: a subdomain of the existing domain — `exams.easywayschoollms.com.ng`
or `osd.easywayschoollms.com.ng`. A candidate about to bank-transfer real
money trusts a subdomain of a name they can already verify far more than an
unfamiliar new domain; this app is organizationally separate (own repo
folder, own database, own Vercel project) without needing a separate domain
name too. Revisit only if this ever gets licensed to another school.

## 2. Database — DONE (2026-09-13)

~~Create a new Neon project~~ — done: `easyway-osd-exam-centre`
(`wild-violet-09588211`, `eu-central-1`, same org as the LMS's Neon
projects but its own project — separate isolation, per `README.md`). Both
connection strings (`DATABASE_URL` pooled, `DIRECT_DATABASE_URL` direct)
are set in this worktree's `osd-exam-centre/.env.local` (gitignored, never
committed) and the initial migration has been applied. Also ran a full
smoke test against it for real — created a sitting, submitted a public
booking, submitted a bank-transfer slip, verified it as admin, confirmed a
real seat number came back (50, matching the descending scheme), confirmed
the roster CSV export and the "seat confirmed" email fired — then deleted
that test data so the database is clean for the real first login. Still
needed for a real production deploy:

1. Set the same two connection strings as env vars on the Vercel project
   (step 3) — `.env.local` only reaches local dev, not Vercel.
2. Migrations run automatically on every subsequent Vercel build (see
   `scripts/vercel-migrate.mjs` — only fires when `VERCEL` is set, so a
   local `npm run build` never touches the real database). The very first
   migration was already applied by hand from this session, so Vercel's
   first build will find it a no-op and move on.

## 3. Vercel project — before it's usable at all

1. New Vercel project, same GitHub repo (`easyway-lms`), **Root Directory**
   set to `osd-exam-centre`. Vercel auto-detects Next.js from there.
2. Set environment variables (Production, and Preview if you want PR
   previews to work) — see `.env.example` for the full list with comments.
   At minimum to boot at all:
   - `DATABASE_URL` and `DIRECT_DATABASE_URL` (step 2 — Neon's connection
     page gives you both; the pooled one has "-pooler" in the hostname, use
     that for `DATABASE_URL`) — note `DATABASE_URL` now gates `/admin/login`
     itself, not just the dashboard behind it: checking the login-attempt
     lockout needs a database read, so a database outage means nobody can
     sign in at all (even with the right password) rather than only "can't
     see bookings". A deliberate fail-closed trade-off — see
     `lib/admin-auth.ts`.
   - `ADMIN_PASSWORD` — pick a real one, this gates the whole back office
   - `SITE_URL` — the domain from step 1, e.g. `https://exams.easywayschoollms.com.ng`
   - `EXAM_BANK_ACCOUNT_NUMBER` (+ `EXAM_BANK_NAME`/`EXAM_BANK_ACCOUNT_NAME`
     if they differ from the defaults) — without this the bank-transfer
     panel just tells candidates to "ask the office" for the account number
3. Attach the domain from step 1 to this Vercel project (Vercel dashboard →
   Domains). If it's a subdomain of `easywayschoollms.com.ng`, that's a CNAME
   record wherever that domain's DNS is managed.
4. Deploy.

## 4. Before real candidates use it — do these before announcing it publicly

- **Object storage** — set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` (Cloudflare R2 or AWS S3). **Without these, every
  passport photo / passport data page / payment slip a candidate uploads is
  silently lost** — Vercel's filesystem is read-only outside `/tmp`, so
  `lib/storage.ts` falls back to writing to local disk, which does not
  persist between requests on Vercel. This is the single most important
  thing to set before letting a real candidate book.
- **Email** — set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`
  (Brevo, the same provider the LMS already uses, or any SMTP relay).
  Without this, booking confirmations, seat-confirmed emails, and the
  nurture drip are only logged to the server console — nobody receives
  anything.
- **Cron** — set `CRON_SECRET` and confirm `vercel.json`'s cron (already
  configured to hit `/api/cron/nurture` daily) is enabled for this project
  — Vercel Cron needs to be turned on per-project, it doesn't inherit from
  the LMS's.
- **Office notifications** — set `OFFICE_NOTIFICATION_EMAIL` so "Need help?"
  messages actually reach someone, not just `/admin/support`.
- **Terms & Privacy pages** (`/terms`, `/privacy`) — the text there is
  placeholder, written to describe exactly what the code does (data
  collected, the non-refundable/automatic-refund policy, exam-day conduct),
  not counsel-approved wording. Have Easyway's management (and ideally a
  lawyer, given this collects passport data and takes payments) review and
  replace it — `app/terms/page.tsx` and `app/privacy/page.tsx`.

## 5. Optional — add when ready, not blocking

- **Flutterwave** (international card payments for diaspora candidates) —
  set `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_SECRET_HASH`. The
  code has never run against Flutterwave's real API (sandbox or live) —
  test it with a real or sandbox transaction before trusting it with a real
  candidate's card. Until this is set, the card-payment button simply
  doesn't show; bank transfer keeps working regardless.
- **The real ÖSD field list**, if Jason sends one that needs more than the
  form currently collects (name/email/phone/address/DOB/place of birth —
  modelled on a real Goethe-Institut confirmation).

## 6. First-deploy smoke test

Once steps 2–3 are done and the site is live:

1. Visit `/admin/login`, sign in with `ADMIN_PASSWORD`.
2. Create one sitting from `/admin/sessions` (mark it published).
3. In an incognito window, go through `/book` end to end as a candidate —
   register, submit a bank transfer (even a fake reference/upload), upload a
   test photo and data page.
4. Back in `/admin`, verify the transfer and approve the documents — confirm
   the candidate's booking page now shows a seat number and a printable
   admission slip.
5. Try "Need help?" from the booking page and confirm it shows up at
   `/admin/support` (and in your inbox, if `OFFICE_NOTIFICATION_EMAIL` is set).

If all five work, the site is genuinely live, not just deployed.
