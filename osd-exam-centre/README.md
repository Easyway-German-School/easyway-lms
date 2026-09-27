# ÖSD Examination Centre

The public booking site for Easyway's ÖSD German-exam sittings: register,
pay, upload your documents, get your seat automatically reserved, print your
admission slip. Separate from the [EasyWay LMS](../prototype) on purpose.

**Deploying this for the first time? See [DEPLOY.md](./DEPLOY.md)** — a
step-by-step checklist (domain, database, Vercel project, env vars, a
smoke test) for everything that needs a human decision or a credential this
session can't provide.

## Why this is a separate app, not a folder inside the LMS

- **Different audience.** A booking candidate is often not an EasyWay
  student and needs no account, no dashboard, none of the LMS's portal
  furniture — just a form, a payment, and a printout.
- **Different database.** This app has its own Prisma schema
  (`prisma/schema.prisma`) and is meant to run against its **own** Postgres
  database (a new Neon project or branch), never the LMS's. Two independently
  migrated schemas sharing one physical database is a foot-gun; a second
  database avoids it entirely, and this repo's own memory has multiple past
  incidents from migration surprises on the shared LMS database.
- **Different deploy.** Meant to be its own Vercel project, rooted at this
  folder, with its own domain (e.g. `exams.easywayschoollms.com.ng` or a
  dedicated domain) and its own env vars.
- **Linked, not coupled.** The only connection to the LMS is a "book prep
  classes" link/CTA (see `EXAM_PREP_CLASS_URL`) — no foreign keys, no shared
  auth, no shared code. A booked candidate who wants prep classes clicks
  through and signs up on the LMS like anyone else.

It lives in this monorepo (rather than a second GitHub repo) purely for
convenience — one place to find things, one `gh` remote. If you'd rather it
be a fully separate repo, it's already isolated enough to `git subtree
split` or plainly copy out without touching the LMS.

## Stack

Next.js (App Router) + Prisma/Postgres + Tailwind v4. No NextAuth, no
component library — deliberately small.

- **Admin auth** is one shared password (`ADMIN_PASSWORD`), not a user
  table — see `lib/admin-auth.ts` for why that's the right amount of
  engineering for one back office reviewing bookings, and what to build
  instead once more than one person needs a distinct audit trail.
- **Candidate auth** doesn't exist — a booking is looked up by reference
  code + email (`lib/booking.ts`, `resolveOwnedBooking`), like an airline
  booking, not a login.
- **File storage** (`lib/storage.ts`) writes to local disk in dev and to any
  S3-compatible bucket (Cloudflare R2, AWS S3) once `S3_*` env vars are set.
  Without them, uploads silently stop persisting the moment this is deployed
  to Vercel (its filesystem is read-only outside `/tmp`) — set them before
  taking real candidates.
- **Payment** — manual Moniepoint bank transfer is the default (`lib/payments.ts`):
  one static account shown to every candidate, a slip uploaded, an admin
  confirms it landed. No live Monnify API integration yet. Alongside it,
  candidates paying from outside Nigeria can pay by **international card
  via Flutterwave** — same naira amount, no surcharge added on this end —
  which settles and assigns a seat automatically (no admin step) via
  `settleCardPayment()`, fired from both the browser redirect
  (`/api/card-payment/callback`) and a webhook (`/api/card-payment/webhook`)
  so a candidate who closes the tab mid-checkout still gets confirmed. Set
  `FLUTTERWAVE_SECRET_KEY` to turn the card button on.
- **Seat numbers** (`lib/seat-numbering.ts`) count DOWN in blocks of 50 —
  50→1, then 100→51, then 150→101 — matching the physical room layout Jason
  described, assigned only once a payment is verified (never at raw booking
  time, so an unpaid booking never occupies a seat).
- **The Panthexa lane + candidate journey** (`lib/panthexa-intake.ts`,
  `lib/journey*.ts`, `lib/invoice*.ts`, `lib/lifecycle.ts`). Candidates
  register on Panthexa (the official ÖSD platform; Easyway is a tenant) and pay
  Easyway directly. The office keys each registration in ONCE (`/admin` →
  "Register a Panthexa candidate"); the system then creates the reference and
  invoice number, renders the examination invoice as a PDF that matches the
  school's own template (`lib/invoice-pdf.ts`), and emails it as Document A.
  Everything after that is one automated, ordered journey — see
  `lib/journey-emails.ts` for the twelve emails (Documents A–M of the
  Candidate Document Pack), `lib/journey-schedule.ts` for exactly when each one
  is due, and `lib/candidate-status.ts` for the Operations Manual §8 status
  (derived from timestamps, never stored). Sent emails are logged per candidate
  in `JourneyEmail` (Manual §46) and that unique (booking, step) row is also
  what stops a double send.
  - Event steps fire immediately from the office action (verify payment →
    Document B + receipt PDF; admit → Document D; release result; certificate).
  - Timed steps come from `/api/cron/nurture` (name kept so the registered
    cron entry still works), daily at 08:00 UTC = 09:00 Lagos: a payment
    reminder the morning after an unpaid booking, the details check a day after
    payment, ONE soft prep-class note ~3 days after payment (only if the exam is
    10+ days away and they haven't already asked), the exam guide, the 7-day and
    24-hour reminders, and "result still pending" after 10 days. At most one
    email per candidate per run, so a missed day never becomes a pile-up.
    Point a scheduler at it with `Authorization: Bearer $CRON_SECRET`.
  - The office can't admit anyone until payment is verified, the details are
    complete and confirmed, and the ID is approved (Manual §12) — enforced in
    `lib/lifecycle.ts`, not just greyed out in the UI.
  - Nothing in the journey talks to Panthexa: it has no public API we could
    find. "Unpaid for a day" is detected from OUR records — the office keying
    the registration in is what starts the clock.
- **"Need help?"** (`lib/support.ts`, `/admin/support`) — a plain contact-the-
  office form, deliberately separate from the journey's prep-class
  note. On the booking page (prefilled), the printed slip's "what to
  bring" section, and the site footer for anyone who hasn't booked yet.
  Saved to the database either way; emailed to `OFFICE_NOTIFICATION_EMAIL`
  when it's set — there's no in-app admin notification system in an app
  this small, so email is the actual inbox.
- **Payment integrity** — a sitting can fill up (via bank transfers an admin
  already verified) in the moments between a candidate starting a card
  checkout and Flutterwave confirming it. Rather than leave someone charged
  with no seat, `settleCardPayment()` in `lib/booking.ts` automatically
  requests a Flutterwave refund the instant that happens, marks the booking
  `refund_pending`/`refund_failed`, and flags it loudly on the admin
  dashboard. Bank transfer can never reach this state — an admin verifies
  the amount before anything is marked paid.
- **Abuse protection on public forms** — a honeypot field (off-screen,
  real visitors never fill it; a bot filling every field it finds gets a
  fake success, not a tell) and a per-email rate limit on both booking
  and "Need help?" submissions. Also: the same email can't book the same
  sitting twice, and a date of birth is validated as a real, plausible date
  rather than trusted as a bare string.
- **Consent** — a candidate explicitly consents to their data (including
  the passport photo/data page they upload) being processed for
  registration and certification, timestamped
  (`ExamBooking.consentAcceptedAt`), separate from the rules acknowledgment
  — see `/terms` and `/privacy`.
- **Admin-side security hardening** — a login-attempt lockout on
  `/admin/login` (10 failures/IP/15min — `lib/admin-auth.ts`, backed by a
  `LoginAttempt` table, not just in-memory, since serverless instances don't
  share memory); constant-time comparison everywhere a secret gets checked
  (the admin session token, the Flutterwave webhook signature — a plain
  `===` on either leaks timing information); baseline security headers
  (`next.config.ts` — `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`); every upload now has to be tied
  to a real, owned booking and pass a per-folder MIME-type allowlist
  (a passport photo can never be a PDF) instead of accepting anything with
  no owner at all; and every candidate-supplied string (a name, a support
  message) is HTML-escaped before landing in an email body
  (`lib/html.ts`), not trusted as-is.
- **Admin refund on cancellation** — cancelling a booking that was already
  paid by card now attempts a Flutterwave refund automatically too (not
  just the automatic full-sitting case above), and marking a seated
  candidate a no-show once there's an actual exam day to do that for.
- **Session capacity can't be lowered below what's already confirmed** —
  editing a sitting's capacity down past the number of seated candidates is
  rejected outright, rather than silently corrupting what
  `seatNumberForIndex()` hands out next.
- **Office operations**: editing an existing sitting after creation (not
  just create-once), cancelling a booking, exporting a CSV exam-day roster
  per sitting, adding a booking manually for a phone/walk-in candidate
  (`createManualBooking`), and a candidate correcting their own typo'd
  details before paying (`updateBookingDetails` — locked once payment
  starts, so a paid/under-review booking needs the office involved instead).

## Design and photography

The public pages are image-led (Goethe-Institut / travel-site style): a
full-bleed hero, boarding-pass details, dusk gradients. Everything visual
lives in `components/home/*`, `components/PageHero.tsx` and the "travel-style
visual system" block at the bottom of `app/globals.css`.

- **Photos** are in `assets/images/` and imported statically (`import x from
  "@/assets/images/x.jpg"`) so Next generates blur placeholders and responsive
  sizes. All are from Wikimedia Commons under permissive licences only — CC0
  or CC BY, never share-alike. `lib/photo-credits.generated.json` holds the
  author/licence/source for each and drives the `/credits` page (linked from
  the footer). **If you add or swap a photo, add its credit there too** — CC BY
  requires the attribution.
- **Live data**: the hero "boarding pass" and the "Departures" board read the
  same public `/api/sessions` the booking wizard uses, so they can never
  disagree with what is actually bookable.
- **Honest copy**: the payment-option wording on the landing page follows
  `cardPaymentsEnabled()` — it only mentions international cards once
  `FLUTTERWAVE_SECRET_KEY` is set. The landing page is re-rendered hourly
  (`revalidate = 3600`) so it catches up after a config change.
- **Link preview** (WhatsApp/Slack/iMessage) is `app/opengraph-image.tsx`.
- Motion (Ken Burns, ticker, scroll-reveal) is disabled under
  `prefers-reduced-motion`.

## Local setup

```bash
cd osd-exam-centre
npm install
cp .env.example .env.local   # fill in DATABASE_URL at minimum
npx prisma migrate dev       # applies prisma/migrations/ to your local database
npm run dev
```

Then create a sitting from `/admin/sessions` (sign in with `ADMIN_PASSWORD`
at `/admin/login` first) before `/book` has anything to show.

## What's genuinely not done yet

- **No real database provisioned.** `DATABASE_URL` is a placeholder — Jason
  needs to create a new Neon project/branch for this app.
- **No object storage configured.** Uploads work locally but need `S3_*`
  env vars before this is deployed for real.
- **No Monnify API integration.** Bank transfer is fully manual — see
  `lib/payments.ts`.
- **No Flutterwave keys yet.** The international-card path (`lib/payments.ts`,
  `initiateCardPayment`/`verifyCardPayment`) is written and typechecked but
  has never run against Flutterwave's real API — `FLUTTERWAVE_SECRET_KEY`
  is a placeholder, and the flow needs an actual test transaction (their
  sandbox test cards) before it's trusted with a real candidate's money.
- **The real ÖSD field list never arrived.** Registration collects the
  fields the reference Goethe-Institut confirmation collected (name,
  address, DOB, place of birth, phone, email) — not necessarily everything
  ÖSD itself requires. Revisit once Jason sends the actual list.
- **Nothing here has been deployed, browser-tested end to end, or shown to
  Jason.** Typechecked and reviewed only.
- **No production database has ever run the login-lockout check.** The
  logic is reviewed and matches the same tested pattern as the booking/
  support rate limits, but the exact "10 failures locks out" threshold has
  only been confirmed to degrade gracefully (no crash) against an
  unreachable placeholder database, not verified end-to-end against a real
  one — there's been nothing real to lock out yet.
