# The platform layer

EasyWay is two products in one codebase.

**The school** is what students and tutors see: classes, tuition, certificates.
**The platform** is what lets a *second* school run on the same deployment
without ever seeing the first one's data — and produces a bill for doing so.

The platform has its own name, brand and domain: **EduPrime**. The school stays
EasyWay (teal, orange, a classroom); the platform is EduPrime (indigo, a
console). See `docs/EDUPRIME_BRAND.md` for the identity and the domain/routing
setup. This document is the mechanics.

If you only run EasyWay itself, you can ignore all of it; `tenant_easyway_root`
already exists and everything works.

- **Operator console:** `/platform` (or `/` on an EduPrime host)
- **Billing:** `/platform/billing` (or `/billing` on an EduPrime host).
  `/admin/billing` redirects here.

There is no marketing/landing page — EduPrime is an internal product surface.

---

## The three roles, and why they are not two

| Role | Column | Can do |
|---|---|---|
| School admin | `adminRole = "super"` | Everything inside **their own** school |
| Platform operator | `platformRole = "operator"` | Create schools, issue API keys, read billing across all of them |
| API caller | an `ApiKey` row | Whatever scopes the key carries, inside one school |

**A super admin is not an operator, and must never be.** EasyWay's own super
admin runs EasyWay — they hire tutors and take fees. If that role also granted
the ability to read another school's register, then owning the software would
mean reading your competitors' student lists. They are separate columns for
that reason.

There is deliberately **no screen** that grants operator. A privilege you can
click into existence is one that eventually gets clicked.

```bash
node scripts/grant-platform-operator.mjs someone@example.com
```

```bash
node scripts/grant-platform-operator.mjs --list
```

`/api/platform/*` returns **404** — not 403 — to everyone else. A 403 confirms
the endpoint exists.

---

## How isolation actually works

You will not find `where: { tenantId }` in any route, and **you must not add
one**. The tenant rides on `AsyncLocalStorage` and the default `prisma` export
applies the filter underneath every query.

- `getServerAuthSession()` sets it for signed-in requests.
- `requireApiKey()` sets it for API-key requests.
- `resolveTenantId()` sets it for public requests, from the **hostname**.

Default is **strict**: a query against a tenant-owned table with no tenant in
context *throws*. That is the point — a forgotten filter fails loudly in
development instead of quietly serving another school's rows in production.

`guardedPrisma` is the deliberate escape hatch, for the handful of places that
legitimately run across tenants (the operator console, the nightly meters).

**If production ever starts throwing "no tenant in context",** set
`TENANT_ISOLATION=warn` in Vercel's environment. It downgrades the throw to a
`console.warn` and takes effect on redeploy of the env var alone — no code
deploy. It is an incident tool, not a setting. Turn it back off.

---

## Walkthrough: onboarding a school

### 1. Create the tenant

`/platform` → **Onboard a school**. Or:

```bash
curl -X POST https://easyway-lms.vercel.app/api/platform/tenants -H 'Content-Type: application/json' -d '{"name":"Bright Futures Academy","slug":"brightfutures","domain":"lms.brightfutures.ng"}'
```

The slug is 3–40 chars, lowercase, hyphens allowed. The tenant and its credit
row are created **in one transaction** — a tenant without a credit row is one
whose first metered request has to invent a balance.

Every new school starts on a **30-day trial**, stored as an explicit
`trialEndsAt` date rather than computed from `createdAt`. If you extend
somebody's trial, that becomes a recorded fact rather than an exception
somebody has to remember.

### 2. Point the domain at it

`domain` is how public pages (signup, the branch list, certificate
verification) know which school they belong to when nobody is signed in. An
unrecognised host falls back to `DEFAULT_TENANT_SLUG` (`easyway`) — never to
"whichever tenant comes first", because that would let a student register at
one school and appear at another.

### 3. Issue an API key

`/platform` → the school → **Issue a key**. Choose **test** first.

```
ewk_test_a1b2c3d4_<43-character secret>
```

Four parts: namespace, environment, prefix, secret. The **prefix** is safe to
log and to paste into a support thread — a partner can name their broken key
without sending you a live credential.

The secret is stored as a **sha256 hash**. It is shown exactly once, at
creation. There is no "show key again" and there cannot be one.

Available scopes:

```
identity:read   students:read    students:write
enrolments:read enrolments:write payments:read
classes:read    attendance:read  attendance:write
usage:read
```

`identity:read` is always granted, so `/v1/me` answers "is this key working?"
from the first minute.

### 4. The partner calls the API

Bearer token, always a header — never a query string, which would put a live
credential into access logs, browser history and referer headers.

```bash
curl https://easyway-lms.vercel.app/api/v1/me -H "Authorization: Bearer ewk_test_..."
```

```bash
curl "https://easyway-lms.vercel.app/api/v1/students?level=B1&limit=50" -H "Authorization: Bearer ewk_live_..."
```

Endpoints: `/v1/me`, `/v1/students`, `/v1/students/{id}`, `/v1/payments`,
`/v1/classes`, `/v1/attendance`, `/v1/usage`.

Paging is cursor-based: pass the returned `cursor` back as `?cursor=`.

**Session cookies are not accepted on `/v1`.** A public API that trusted
cookies would be callable from any page a signed-in user happens to visit —
that is CSRF by construction. A bearer token cannot be attached by a browser on
someone's behalf.

Rate limits: **120 req/min per key**, 30/min per IP for failed auth. Honest
caveat — the counter is per serverless instance, so the real ceiling is that
number times however many instances are live. Fine while partners are few;
first thing to move to Redis when they are not.

### 5. Usage accrues

Six meters, in `src/lib/usage/meter.ts`:

| Meter | Billed per | Source |
|---|---|---|
| `ai.tokens` | 1,000 tokens | model provider |
| `live.participant_minutes` | participant-minute | LiveKit |
| `storage.gb_month` | GB-month | R2 |
| `email.sent` | send | email provider |
| `api.request` | 1,000 requests | *the platform itself* |
| `students.active_monthly` | active student | *the platform itself* |

Five of six are **pass-throughs of a bill this platform already receives**.
That is the pricing argument: a school can be shown exactly which of its own
actions produced each line, and the margin is a stated multiple rather than a
number somebody picked.

**Test keys are never metered.** A sandbox that costs money is a sandbox nobody
develops against.

Every event carries an **idempotency key derived from the source event**, never
from a timestamp or a counter — so replaying an event a year later produces the
same key and is rejected as the duplicate it is. `meterKey()` throws if you
hand it a bare number.

### 6. The nightly job bills it

`/api/cron/tick`, 06:00 daily (`vercel.json`).

1. Read storage per tenant — recorded as **a thirtieth** of stored GB per day,
   so a month of readings sums to one GB-month. Charging full daily would bill
   thirty times the rate.
2. Count active students for the month.
3. Roll yesterday's events into `UsageDaily` and debit `TenantCredit`.
4. Warn anybody at or below their low-balance threshold.

Rounding happens **once, in the daily rollup** — never per event. Rounding a
thousand one-token calls up individually bills a customer a hundred times what
they used, and they would be entirely right to be angry about it.

Every step is keyed on the day, so re-running the job restates rather than
double-charges.

### 7. Low balance and top-up

At or below threshold, the school gets an in-app notification and a
`credit.low` webhook. The flag clears on top-up, so a school that runs low,
pays, and runs low again is warned **both** times.

The school tops up at `/platform/billing` — Paystack, prepaid, in naira. The
webhook branches on `metadata.kind === "platform_topup"` **first**, before the
student-payment path. Without that discriminator a top-up arrives looking like
a student payment and gets credited to a student who never paid.

---

## What is not built yet

Be straight with anybody you're selling to about these.

- **Nothing is enforced.** A tenant at zero or negative balance is *warned* and
  then **served normally**. `graceKobo` exists on the row but is only read for
  display — no route checks a balance before doing work. There is no suspension
  path.
- **The rates are placeholders.** `PLACEHOLDER_RATES_KOBO` is marked as such in
  the source so nobody quotes it by accident. They need real provider invoices
  and a margin decision before a customer sees a number.
- **No self-service signup.** A school is onboarded by an operator, by hand.
  The EduPrime marketing site has a "book a demo" form (`/api/platform/enquiry`)
  that logs the enquiry and optionally pings `PLATFORM_ENQUIRY_WEBHOOK` — it
  creates **nothing**. No User, no Tenant, no lead row (leads are tenant-scoped
  and a platform enquiry belongs to no tenant).
- **No `POST /v1/students`.** Enrolment writes a User, a Student, a student
  code and an office alert together, and has photo-upload and branch-pricing
  steps. Half of that over the API produces accounts the school's own screens
  cannot finish setting up, so it returns an explanatory 400 instead.
- **RLS is not on.** `02_rls_DANGEROUS.sql` is written and deliberately not
  run. Isolation is currently application-level only.
- **The repo is public.** See the commercial note before putting anything
  customer-identifying in it.

## Proving it still works

All safe to re-run.

```bash
node scripts/prove-tenant-isolation.mjs
```

```bash
node scripts/prove-api-key.mjs
```

```bash
npx tsx scripts/prove-billing.ts
```

The billing one checks idempotency on every retry path — that is the property
that makes the ledger arguable-with, so run it after touching anything under
`src/lib/usage/`.
