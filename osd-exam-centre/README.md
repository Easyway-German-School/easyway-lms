# ÖSD Examination Centre

The public booking site for Easyway's ÖSD German-exam sittings: register,
pay, upload your documents, get your seat automatically reserved, print your
admission slip. Separate from the [EasyWay LMS](../prototype) on purpose.

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
- **Payment** is manual Moniepoint bank transfer only (`lib/payments.ts`):
  one static account shown to every candidate, a slip uploaded, an admin
  confirms it landed. No live Monnify/Paystack/Flutterwave API integration
  yet — `cardPaymentsEnabled()` exists as the seam to wire one in later.
- **Seat numbers** (`lib/seat-numbering.ts`) count DOWN in blocks of 50 —
  50→1, then 100→51, then 150→101 — matching the physical room layout Jason
  described, assigned only once a payment is verified (never at raw booking
  time, so an unpaid booking never occupies a seat).
- **Nurture drip** (`lib/nurture.ts`, `/api/cron/nurture`) — +2 days after
  confirmation (educational, no pitch), 7 days and 3 days before the exam
  (practise nudges with a link to prep classes). Point a scheduler (Vercel
  Cron via `vercel.json`, or any cron) at it daily with
  `Authorization: Bearer $CRON_SECRET`.

## Local setup

```bash
cd osd-exam-centre
npm install
cp .env.example .env.local   # fill in DATABASE_URL at minimum
npm run db:push              # or: npx prisma migrate dev, once real migrations exist
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
- **No card payment** — the whole exam fee currently has to go through a
  Nigerian bank transfer, which excludes diaspora candidates sitting abroad.
  `cardPaymentsEnabled()` is a stub for wiring up Paystack/Flutterwave later.
- **The real ÖSD field list never arrived.** Registration collects the
  fields the reference Goethe-Institut confirmation collected (name,
  address, DOB, place of birth, phone, email) — not necessarily everything
  ÖSD itself requires. Revisit once Jason sends the actual list.
- **Nothing here has been deployed, browser-tested end to end, or shown to
  Jason.** Typechecked and reviewed only.
