# Deploying `osd-exam-centre`

A step-by-step checklist, in order. Nothing here can be done by an AI
session — each step needs an account, a payment, or a decision only Jason
can make. Skip a "before real candidates" step and the site still runs;
skip a "before it's usable at all" step and it won't start.

## 1. Domain — DECIDED (2026-09-14), not yet registered

~~Recommended: a subdomain of easywayschoollms.com.ng~~ — superseded by
Jason's own call: **`easywaygermanexamregistration.com`**, at the domain
root (not under a path like `/osd` — confirmed explicitly, since a path
would need a Next.js `basePath` change and something else answering the
root). **Not registered yet** as of this writing — DNS doesn't resolve and
nothing indicates it's taken, but that's not an authoritative check.
Registering it (an AI session can't purchase domains or hold payment
info) is the one remaining step:

- **Easiest**: Vercel dashboard → `easyway-osd-exam-centre` project →
  Domains → type the domain in → if available, register it right there.
  Zero DNS config needed afterward, it just works.
- **Or**: register anywhere else (Namecheap, Cloudflare Registrar,
  GoDaddy...) and come back for the CNAME record + attaching it in Vercel.

Once registered: attach it to the Vercel project, then update `SITE_URL`
(currently the Vercel-assigned placeholder — every email link depends on
this being right).

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

## 3. Vercel project — DONE (2026-09-13)

~~New Vercel project~~ — done: `easyway-osd-exam-centre`
(`prj_gMofUcjuAF8gdIkEB1ZqDkO12RTy`, team `jaysmithstrategist-2324's
projects`), linked to the same GitHub repo, **Root Directory**
`osd-exam-centre`, function region `fra1` (matches the Neon database's
`eu-central-1`, for latency). Env vars set for the `production` target:
`DATABASE_URL`, `DIRECT_DATABASE_URL` (step 2's real values),
`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (freshly generated, not a
placeholder — the password is `53kUIpQUEuOoKKAe`, change it in Vercel's
project settings any time you want a different one), `CRON_SECRET`
(generated), and `SITE_URL` (temporarily the Vercel-assigned domain until
step 1's real domain is attached — **update this once the domain is live**,
since it drives every link in every email this app sends). Not yet set:
`EXAM_BANK_ACCOUNT_NUMBER`/`EXAM_BANK_NAME`/`EXAM_BANK_ACCOUNT_NAME` (no
real account number handed over yet — until then the bank-transfer panel
tells candidates to "ask the office"), and the object-storage/email/
Flutterwave vars covered in section 4 below. Preview-target env vars were
deliberately left unset — this project has only one Neon database so far,
and a PR-preview deployment writing test data into that same database
would be a real problem; set up a second Neon branch first if PR previews
need to work end to end.

**Deployment protection disabled on purpose.** Vercel's team-wide default
("Deployment Protection: all except custom domains") would have kept the
`*.vercel.app` URL behind a Vercel-login wall — fine for the LMS's internal
tool, wrong for a public booking site that needs to be reachable by anyone
before a custom domain even exists. Turned off (`ssoProtection: null`) for
this project specifically; the LMS's own project setting was untouched.

**Verified live, not just "build succeeded"**: deployed the
`feat/osd-exam-centre` branch directly as this project's production build
(the only branch with the app's code, since PR #74 hasn't merged to `main`
yet — merge it whenever you're ready to review, and future pushes to
`main` will auto-deploy the normal way). Confirmed against the actual
deployed URL: `/`, `/book` both 200; `/api/sessions` returns real JSON
from the real database (`{"sessions":[]}`, matching the clean state from
step 2); admin login with the generated password works and returns a real
(empty) bookings list; all five security headers present with the exact
values this app's `next.config.ts` sets (not Vercel's platform defaults);
the daily nurture cron auto-registered from `vercel.json`.

Once the real domain (step 1 — `easywaygermanexamregistration.com`, not
registered yet) is ready: attach it in Vercel dashboard → Domains (or it's
automatic if registered through Vercel directly), then update `SITE_URL`
to match.

## 4. Before real candidates use it — do these before announcing it publicly

- **Object storage — DONE (2026-09-15).** ~~set `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`~~ — real
  Cloudflare R2 bucket `easyway-osd-exam-centre` (Jason's own Cloudflare
  account, same one the LMS's R2 uses), Public Access deliberately left
  disabled. Since the bucket is private, uploaded files are served through
  this app's own admin-only proxy (`app/api/files/[...key]/route.ts`)
  rather than a raw bucket URL — see `lib/storage.ts`'s `readUpload()` and
  the comment there for why (passport photos and bank slips shouldn't get
  a public, even "unlisted," URL). Verified live: a real upload landed in
  the real bucket, an unauthenticated request to read it back got 401, an
  admin-session request got the exact bytes back. Env vars set on both
  `.env.local` and the Vercel project's production environment.
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
