# EasyWay LMS — how it works, layer by layer

Written so that one person can explain this system, in depth, to another engineer — from the
database up to the pixels, and from the happy path to the failure path.

Every claim here points at a file. Where something is a deliberate limitation, it says so in a
section called **Honest limits**, because the fastest way to lose an engineer's trust is to
oversell. Read that section twice.

---

## 0. The 60-second version

EasyWay is a **multi-tenant learning-management platform** (German-language school, Nigerian
market, ~400 students today, designed so the number is not the constraint). It is:

- a **Next.js 16 (App Router) monolith** deployed on **Vercel serverless** — no servers, no
  containers we operate;
- backed by **one Postgres database on Neon** (serverless Postgres, `eu-central-1`), accessed only
  through **Prisma**;
- with the database client wrapped in a **stack of extensions** that enforce, underneath every
  query, three things that used to depend on developers remembering: *tenant isolation*,
  *reversible deletes with an audit trail*, and *survival of a cold database*;
- whose **business rules live in one place each** (for example "may this student open the
  portal?"), so two screens cannot disagree;
- surrounded by a **self-observation loop** — errors and complaints are recorded, grouped,
  reopened on regression; students' screens report what they actually show and are compared to
  the database; all of it is visible in a developer console;
- and protected by a small **resilience toolkit** — deadlines, circuit breakers, bulkheads — so
  that a slow or dead dependency (payment provider, AI provider, the database itself) degrades
  one thing instead of everything.

The organising idea, if you need one sentence: **make the mistakes structurally impossible or
loudly visible, rather than asking people to be careful.**

---

## 1. The shape of it

```
  Student phone / browser (PWA)              Admin console (/admin/*)         Tutor / Parent
            │                                        │
            ▼                                        ▼
  ┌─────────────────────────── Vercel edge ───────────────────────────┐
  │ src/proxy.ts   portal gating · rate limits · CSP / security headers │   ← the "API gateway"
  └───────────────────────────────┬─────────────────────────────────────┘
                                  ▼
  ┌──────────────────── Route handler  (src/app/api/**/route.ts) ─────────────────┐
  │  requireAuthSession() / requireCapability()  → session + TENANT SCOPE + AUDIT ACTOR │
  │  shapes the response for ONE client (backend-for-frontend)                      │
  └───────────────┬──────────────────────────────────────┬──────────────────────────┘
                  ▼                                      ▼
     Business rules (src/lib/*)                Outbound calls — guardedFetch()
     accessFromStudent → portalVerdict         deadline + circuit breaker per provider
     ledger · payment · assignment …           Paystack · Groq · Anthropic · DeepSeek · OpenAI
                  ▼
  ┌────────────── Prisma client = an onion of extensions (src/lib/prisma.ts) ───────────────┐
  │  cold-start retry  →  guard (soft-delete, audit trail, bulk-write cap)  →  tenant scope │
  └────────────────────────────────────────┬────────────────────────────────────────────────┘
                                           ▼
                             Neon Postgres  (pooled connection; audit table immutable in-engine)

  Side systems:  Cron tick (36 jobs, in lanes) · GitHub Actions (backups, email flush, restore drill)
                 LiveKit (live classes) · Backblaze B2 (recordings, files) · Brevo SMTP (mail)

  The loop that watches all of the above:
     error / complaint / screen report  →  Incident  →  Mission Control (/admin/developer)
```

---

## 2. The data layer (start here — everything else stands on it)

### 2.1 Postgres on Neon, accessed through Prisma

- **Neon** is Postgres with compute that *suspends when idle*. That is cheap and it has a
  consequence you must be able to explain: the first query after an idle spell can fail with
  Prisma error `P1001` ("can't reach database server") while compute wakes.
- The connection string the app uses is the **pooled** one (PgBouncer-style). Serverless creates
  many short-lived instances; each opening its own direct connection would exhaust Postgres's
  connection limit. `pg_dump` and migrations need the **direct** string — a pooler cannot hold a
  dump snapshot.
- The Prisma client is cached on `globalThis` (`src/lib/prisma.ts`) so a warm serverless instance
  reuses one client (one connection pool) across requests instead of one per request.

### 2.2 The client is an onion

`src/lib/prisma.ts` builds the client in layers using Prisma **client extensions** (`$extends`
with `query.$allModels.$allOperations` hooks). Every query in the application — no exceptions,
because there is no other way to get a client — passes through all of them.

| Layer | File | What it does | Why it is a layer, not a helper |
|---|---|---|---|
| **Cold-start retry** | `lib/prisma-cold-start-retry.ts` | Retries only cold-start errors (`P1001`, initialisation errors, "can't reach database server"), **3 times at 0.5 s, 1.5 s, 3 s** (a fixed, growing schedule — no jitter) | `P1001` means the connection was *never made* — nothing reached the server, so a retry cannot double-write. That is the **idempotency condition** that makes retrying safe here. The schedule was extended once because a tutor's photo save exhausted the original two retries and was lost: the failure was "not quite enough time", not "retries too rare". |
| **Guard** | `lib/prisma-guard.ts` | Turns deletes into soft deletes, writes before-images to `AuditLog`, refuses huge writes | The schema has **42 `onDelete: Cascade`** relations: one `student.delete()` would silently take payments, grades, certificates and recordings with it. |
| **Tenant scope** | `lib/tenant/extension.ts` | Adds `WHERE tenantId = …` to reads, stamps it on creates | Isolation used to be a helper called on 1 route in 51. "Discipline does not scale to a platform." |

> Ask yourself: *what fails if the layer is a function you must remember to call?* The 47th
> route someone writes at 2 a.m. is the one that leaks or deletes. So the rule is enforced where
> forgetting is not an available option.

### 2.3 Soft delete, audit trail, and the "undo first, backups second" philosophy

`lib/prisma-guard.ts`:

- **15 models** are soft-deleted (`User`, `Student`, `Lecturer`, `Payment`, `TuitionCharge`,
  `Certificate`, …): `delete` becomes `deletedAt = now()`, and reads get `deletedAt IS NULL`
  folded in, so the rest of the app behaves as if the row were gone. Criterion: it is the parent
  of a cascade, **or** a financial/legal record the school must still be able to produce next year.
- **22 models** are *fully audited* (creates and updates, not only deletes): money, marks,
  identity, access. Deliberately **not** everything — capturing a before-image costs an extra read
  per write, and models like `VideoProgress` are written on nearly every page view. Auditing those
  would double the portal's query count to record that someone watched four more seconds.
- **`deleteMany` with no `WHERE`, or touching more than 200 rows, is refused** (`GuardError`).
  `deleteMany({})` is valid Prisma and means "every row". A job that genuinely needs more says so
  in code with `runWithAuditActor({ allowUnscopedWrites: true })`.
- **`AuditLog` is immutable in the *engine*, not just the app.** A Postgres trigger
  (`AuditLog_immutable`) rejects UPDATE/DELETE except on three columns (`restorable`,
  `restoredAt`, `restoredById`). Pruning requires `SET LOCAL easyway.audit_prune = 'on'` inside a
  transaction. Reason: *the application is what gets compromised*, so the trail cannot be
  something the application can rewrite.
- **The actor** (who did this) rides on `AsyncLocalStorage` (`lib/audit-context.ts`), set once
  inside `requireCapability()`. Nobody passes "who" down through function arguments.

The design bet, stated plainly: the realistic disaster is *a person, in a hurry, on the right
database* — not Neon losing data. Restoring a whole database discards everyone else's work to
recover one row. So the first line of defence is **row-level undo** (`/admin/security`), the
second is backups.

### 2.4 Multi-tenancy: shared database, shared schema, `tenantId` on every tenant-owned row

`lib/tenant/registry.ts` is the **single source of truth**. Every Prisma model must be listed as
either `TENANT_OWNED_MODELS` (~110 of them) or `GLOBAL_MODELS` **with a written reason**. A test
(`tenant/isolation.test.ts` → `assertRegistryCoversSchema`) fails the build if a model exists in
`schema.prisma` but in neither list. The failure mode this prevents: *somebody adds a table in six
months, nobody notices it has no tenant column, and one school reads another school's students.*

Things worth being able to explain:

1. **Why `tenantId` is denormalised onto each table** instead of reached through a join
   (`Payment → Student → User → tenantId`): (a) row-level-security policies are evaluated per row —
   a plain column comparison is fast and writable, a three-table join is neither; (b) a relation
   path breaks on a nullable link (`Student.branchId` is nullable and 16 students have none), so
   isolation would silently stop protecting exactly those rows. *Isolation must not depend on
   optional data.*
2. **Where the tenant comes from** — `lib/tenant/context.ts`, an `AsyncLocalStorage` scope filled
   in by the auth seam. It **fails closed**: a tenant-owned query with no scope in context
   *throws* (`TenantIsolationError`) instead of returning everything.
3. **The mutable-holder trick.** `AsyncLocalStorage.enterWith()` only reaches the caller if it
   runs *before the callee's first `await`*. Every auth gate must `await` a session lookup before
   it knows the tenant. So `beginRequestScope()` installs an **empty holder synchronously** (which
   does reach the caller) and the gate **fills it in by reference** when the answer arrives. Five
   concurrent requests get five holders. This was measured under concurrency, not reasoned about.
4. **The escape hatch is deliberately awkward.** Cross-tenant work (the cron, backups, operator
   tooling) needs `runUnscoped("a reason of at least 10 characters", fn)` — "what ran across all
   tenants last Tuesday, and why" is therefore answerable.
5. **Nested creates.** A Prisma extension only sees the *top-level* operation:
   `user.create({ data: { lecturer: { create: … } } })` arrives as one `User.create`, so the
   nested `Lecturer` was created with `tenantId = NULL` (this actually shipped and bounced every
   new tutor out of the portal). The extension now walks the payload using Prisma's DMMF relation
   map and **stamps** nested creates. It stamps rather than refuses — refusing is purer but turns
   every unfixed call site into a 500 at deploy time, and adding the correct owner is never the
   unsafe direction.
6. **`GLOBAL_MODELS` and the sessionless-writer trap.** A model written by something with no user
   session (a webhook, a cron job, a CI check-in, the error recorder) gets `tenantId = NULL`, and
   the tenant-scoped read then *filters those rows straight back out*. This froze the backup-status
   page ("Never run" forever). Such tables must be classified global. `Incident` is one.
7. **Two layers by design.** Application-level scoping (ergonomic, only covers code that goes
   through Prisma) plus Postgres **row-level security** (absolute, covers raw SQL and psql).
   *Honest status: the RLS policies are written (`prisma/manual/`) but **not applied**.* See §8.

### 2.5 Migrations

Run from `prototype/`. Hand-written, **idempotent** SQL (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`) because the project used `db push` before it used migrations, so a
database may already contain a change. `prisma migrate dev` is banned (its shadow database cannot
replay history). The recipe: write SQL → `db execute` → **confirm it worked** → then
`migrate resolve --applied`. *Order matters:* on a flaky connection `resolve` once succeeded while
the SQL was still failing, so the database briefly claimed a table existed that did not.

---

## 3. The front door and identity

### 3.1 `src/proxy.ts` — the gateway

Next 16 renamed `middleware.ts` to `proxy.ts`. It runs at the edge before any route and owns rules
that must not depend on a route remembering them:

- **Portal gating** (`/admin`, `/lecturer`, `/parent` by URL prefix): a *fast-path reject* for "no
  session" or "wrong portal". It is explicitly **not the authority** — every route still calls
  `requireAuthSession()`, which does the DB-backed work the edge cannot (tenant scoping; catching a
  tutor revoked mid-session, whose JWT still says "lecturer").
- **Rate limits** — sign-in 10 / 5 min, sign-up 5 / hour, AI 30 / 5 min, payments 20 / 5 min,
  leads 10 / hour. **Honest:** the counter is in the memory of one edge isolate; Vercel runs many,
  and a cold start forgets. It stops the common case (one script hammering one endpoint), not a
  distributed attacker. The upgrade is a shared counter (Upstash Redis) inside `hit()` and nowhere
  else.
- **Security headers + CSP** — shipped in **Report-Only** until `CSP_ENFORCE=true`, deliberately, so
  a policy mistake cannot break the site while it is being tuned.

### 3.2 Auth and permissions

- NextAuth (credentials) with JWT sessions; `requireAuthSession()` is the seam that also sets the
  tenant scope.
- **Capabilities, not roles, at the gate.** `requireCapability("payments")` etc. Admin sub-roles map
  to capability sets (`lib/admin-roles.ts`). `payments`, `security` and `payroll` are
  **super-only** and stay out of every preset — "an audit trail readable by the people it records
  has an obvious incentive problem".
- TOTP two-factor is built and enrolled for the super admin; **enforcement is off** (§8).

---

## 4. Business rules live in one place each

The most instructive history in the codebase: **"may this student open the portal?"** was
re-derived in **13 places across 4 rounds of bug fixes**, and each time the copies had drifted
(admin said "open", student saw "locked"). The fix was structural:

- `lib/student-access.ts` — `accessFromStudent(row)` is the *only* function that turns a fetched
  student into an access verdict; `STUDENT_ACCESS_SELECT` is the exact field set it needs.
- `lib/access.ts` — `deriveStudentAccess()` is the pure rule (per-level tuition **ledger**, FIFO,
  ≥60% part-payment, 30-day lock, grace, payment-plan adherence, upcoming-intake wait).
- `scripts/check-payment-gate-drift.mjs` — a **static guard that fails CI** if any route calls
  `deriveStudentAccess` directly, or writes a bare "paid vs fee" comparison outside an allow-list.
  It was tested by writing a violating file and confirming the build failed.

Principle: a **backend-for-frontend route shapes data; it never decides.** The decision lives in
one pure, tested function.

---

## 5. The hardening programme — what was built and why

This is the part that was built recently and deliberately. Each item: the problem, the mechanism,
the design decision that matters, and where to read it.

### 5.1 The Incident register  (`lib/incidents.ts`, `Incident` table)

**Problem.** An error was one `console.error` line in a log nobody reads; a complaint was a row
nobody aggregated. Neither could answer *"is this new, how often, did we already fix it?"* —
which is the question every self-correcting loop starts from.

**Mechanism.** One row per *distinct problem*, not per occurrence. Two hundred students hitting the
same 500 is one row with `occurrences = 200`.

- **Fingerprint** = hash(kind, route, *normalised* message). Normalisation replaces ids/uuids/
  numbers/quoted values so `Student clx…1 not found (attempt 3)` and `Student cmy…9 not found
  (attempt 41)` are the same problem. The hash is a pure-JS 2×53-bit `cyrb53` (≈106 bits) — not
  `node:crypto`, because this file is reachable from `instrumentation.ts`, which Next also compiles
  for the *edge* runtime where a `node:` import breaks.
- **Scrubbing** (emails, tokens, phone numbers, DB URLs) *before storage* — the incident table is
  read by more people than the request that produced the error, so it must not become a second
  copy of that data.
- **Regression tracking.** If an incident marked `resolved` occurs again it **reopens** and
  `reopenedCount++`. A fix that did not hold is the most valuable signal the table can give.
- **Storm guard.** A per-instance throttle (one write per fingerprint per 30 s, counting the rest)
  so a failing database cannot turn into a write storm into itself.
- **Complaints fold by *page*, not by wording**, so five students describing `/live` five ways is
  one incident with five occurrences.
- **Hooked in at Next's official seam:** `src/instrumentation.ts → onRequestError →
  lib/capture-error.ts → recordIncident`. Cron failures use the same path.

**A bug worth telling.** The fingerprint was first computed from the *scrubbed* message. `scrub()`'s
phone-number regex ate the digit run inside record ids, so two ids became two "different" problems.
Unit tests passed; only running against the real database showed two rows. Lesson: *test the
seams, not just the functions.*

### 5.2 The portal verdict and the witness  (`lib/portal-verdict.ts`, `lib/portal-witness.ts`)

**Problem.** "Admin sees open, student sees locked." Root cause found: the student's screen locks on
**payment/intake OR a missing photo**; the admin Remote View read only payment. A paid student with
no photo saw a padlock while the office's mirror said "open".

**Mechanism — two ideas:**

1. **One composed verdict.** `portalVerdict(access, hasPhoto)` returns *every* reason the portal is
   walled (deposit, balance, upcoming batch, photo), each with a human label and *what lifts it*.
   The student API, the admin Remote View and the dashboards all use it.
2. **The witness.** The server can compute what the portal *should* show. It cannot see what a
   browser — possibly running old cached JS or an old cached response — *actually* put up. So the
   shell reports it (`usePortalWitness` → `POST /api/student/witness`) and the server compares with
   `judgeWitness()`:
   - **render drift** — the browser showed a lock its *own* data did not justify (both facts come
     from the same response, so there is no race to excuse it: a logic bug or stale code);
   - **stale drift** — the browser is acting on a verdict that no longer matches the database *and
     the data is more than 90 s old* (the 90 s is the race window: a payment landing a moment ago
     is not a fault).
   Either raises a `drift` incident. `AccessSnapshot` stores, per student, the current verdict, **`changedAt`
   (moves only when the verdict changes — so it means "locked *since when*")**, and the last screen
   state the browser reported.
3. **Self-heal:** a *locked* student's shell re-polls the access endpoint every 30 s (visible tab
   only; not for an upcoming-intake wait, where nothing can change for weeks), so a stale lock
   clears without a reload.

**The concept to name:** this is a **reconciliation loop** — the same idea as a Kubernetes
controller: compare *desired/believed state* with *observed state* and act on the difference. The
browser is a distributed component whose real state the server cannot otherwise know.

### 5.3 Mission Control  (`/admin/developer`, `components/developer/*`, `app/api/admin/developer/*`)

Gated by the super-only `security` capability. Tabs: **Live · Incidents · Access drift · Backend map
· Patterns**.

- **Polling design.** Cheap indexed counts; pauses while the tab is hidden; failed polls draw as
  *gaps*, never zeros (a database that stops answering must not draw as "fast").
- **The Backend map** is generated *from the source* (`scripts/build-backend-graph.ts` →
  `src/generated/backend-graph.json`, also run before every build and never allowed to fail one):
  - a regex pass over ~350 routes and ~270 libraries finds `@/lib/…` imports and
    `prisma.<model>.<op>` calls, **strips comments first** (comments mention tables they do not
    use), and classifies each table touch as read or write (`lib/backend-graph.ts`, pure and tested);
  - a route's node id is its Next `routePath` (`/api/student/access`), which is *exactly* the shape
    `onRequestError` reports — so an incident lands on its node with **no translation table**;
  - layout is layered/Sugiyama-style: three columns (tables | libraries | routes), then a few
    **barycentre sweeps** (order each column by the mean position of its neighbours) so edges stay
    short and mostly uncrossed;
  - the full graph is ~730 boxes and 10,000 px tall — fitted to a screen it is an unreadable
    sliver — so it opens **focused** on one area (BFS neighbourhood, capped so a hub cannot drag
    in everything), with "plumbing" (`prisma`, `auth`, `admin-roles`, `tenant/context`) hidden by
    default because everything imports it.
  - **Honest limit:** it is a *static* reading. A table reached through a dynamic string or a nested
    relation write is invisible. It answers "what touches this?" reliably for direct cases and is
    *silent*, not wrong, for the rest.
- **The Patterns tab** maps five well-known patterns (gateway, backend-for-frontend, circuit
  breaker, retry-with-backoff, bulkhead) to this codebase with live breaker state.

### 5.4 The resilience toolkit  (`lib/resilience.ts`)

Four small, independent, composable tools. Everything takes its clock / sleeper / RNG as an
argument so a 30-second timeout is tested in a millisecond.

| Tool | Answers | Mechanism | Trap |
|---|---|---|---|
| `retryWithBackoff` | "might work if we wait" (a *transient* fault) | exponential wait with **full jitter** (random slice of the ceiling) so clients don't retry in lockstep — the *thundering herd* | Only safe if repeating is idempotent. **Never blind-retry a payment.** |
| `createCircuitBreaker` | "it is not going to work, stop asking" (a *sustained* fault) | closed → (N failures in a row) → open → (after a pause) → half-open → **one** probe → closed/open | The open state must be *handled on purpose* (skip, serve stale, say so) — it turns a slow cascading failure into a fast contained one. State is **per server instance**. |
| `createBulkhead` | "this workload gets its own share" (a fault must not *spread*) | concurrency limit + **bounded queue**; overflow is *rejected*; a finishing call hands its slot straight to the next waiter | An unbounded queue just converts overload into memory growth and 40-second waits. Shed load early, on purpose. |
| `withTimeout` | "stop waiting" | `Promise.race` with a timer | **A timeout stops the *waiting*, not the *work*.** JS cannot cancel a running promise. The abandoned work carries on; its later failure is swallowed (`.catch(() => {})`) so it can't crash the process. Where possible, *also* give the work a real way to stop (an `AbortSignal`). |

Breaker vs bulkhead: the breaker asks *"is the dependency broken?"*; the bulkhead asks *"is this
workload using more than its share?"* — it protects everyone else from a workload that is merely busy.

**Applied for real:** the incident recorder's DB writes sit behind a bulkhead (2 in flight, queue 20)
and a breaker (trips after 4 failures, 30 s) — *observability must never take down what it
observes.* A test simulates a dead database: writes stop after 4 failures and resume by themselves.

**A bug worth telling.** The breaker's default clock was `now = Date.now`, which captures the clock
function once, at creation, so fake timers installed later were ignored and the recovery test
failed. The default is now `() => Date.now()`. Any "injected clock" must be looked up at call time.

### 5.5 `guardedFetch` — deadline first, breaker second  (`lib/guarded-fetch.ts`)

Every outbound call to Groq, Anthropic, DeepSeek, OpenAI and Paystack goes through it.

**The finding that drove the design:** *none of these calls had a timeout.* A breaker only counts
failures, and **a call that hangs never fails** — it sits until the platform kills the function at
60 s. So a provider that is *slow* rather than *down* (the case that most needs a breaker) was
invisible to any breaker. Every call now has a deadline (AI 50 s, just under the function limit;
Paystack 20 s; background transcription 120–240 s inside the 300 s cron function).

**What counts as the provider failing** — the rule that matters most for payments:
- counts: network error, timeout, **5xx, 429, 408**;
- does **not** count: any other 4xx (bad request, declined card, duplicate reference). Those mean
  the provider *answered correctly about our request*. If they tripped the breaker, a few customers
  mistyping an email could switch payments off for everyone.

**Caller-compatible by construction:** a 5xx is *counted* but the caller still receives the ordinary
`Response`, so their `!response.ok` handling is untouched; network failures/timeouts still throw. The
only new thing a caller can see is `BreakerOpenError`, thrown instantly while the circuit is open —
which every call site already treated as "provider unreachable". One breaker per provider, so Groq
being down never stops payments. **Never retried** (initialising a payment creates state at Paystack).
Human wording: *"Nothing has been charged. Please try again in a minute."* and, for verification,
*"It has not been lost"* — never tell someone their payment failed because **our check** couldn't run.

### 5.6 The cron tick, in lanes  (`lib/cron-lanes.ts`, `app/api/cron/tick/route.ts`)

**Problem.** One daily cron (06:00 UTC) ran **36 jobs sequentially in a single 300 s function.** One
hung job (a partner's webhook endpoint, a LiveKit call with no timeout) stood between every later
job and its turn — and because it runs *once a day*, "your streak ends today" was worth nothing a
day late. One flooded compartment sank the ship.

**Mechanism — the bulkhead pattern applied to scheduled work:**
- **Lanes are chosen by what the work depends on**, because that is what fails together:
  `delivery` (mail + money), `nudges` (cheap notifications), `housekeeping` (metering, backups,
  partner webhooks), `ai` (model providers), `media` (LiveKit, storage, speech-to-text).
- **A prelude** runs first, alone: `payment-plans` sweeps who is behind. Other jobs decide who is
  locked out, so that ordering constraint is honoured rather than assumed.
- Lanes then run **at the same time**, each with its own time budget and a **cap per job** (webhooks
  get less rope — they hit servers we don't control). Order *within* a lane is preserved, so the old
  sequential dependencies still hold (meter usage → roll it up → warn on low balance; reconcile a
  recording → transcribe it).
- A stuck job is **abandoned at its cap** and reported `timed_out`; a lane that spends its budget
  **skips only its own remaining jobs** (reported `skipped`, not silently dropped) and touches nobody
  else's. A total tick budget (270 s) means no lane can outlive the function.
- **A test reads the route source** and fails if a job is registered but not in the plan (it would
  silently never be scheduled) or planned but not registered (a ghost) — the same "make forgetting
  impossible" principle as the tenant registry.
- `?lane=media` runs one lane alone, so the heaviest work could later be given its own scheduler and
  a whole function of its own.

**Honest limits:** timeouts abandon rather than kill (see `withTimeout`); lane timings live only in
the tick's response — nothing stores how close a lane runs to its budget, so you'd see a job *fail*
but not *creep* toward failing.

### 5.7 How it is verified

- **Unit tests** with injected clocks for every pattern; a *plan drift* test for the cron; a
  registry-coverage test for tenancy.
- **Live-database verification scripts** for anything that writes (they found two bugs unit tests
  missed), with the test rows deleted afterward.
- **Static guards** in CI (payment-gate drift).
- **CI** runs typecheck, the drift guard, and the full test suite as blocking gates.
- Deployment is verified by the **build log's route table** and **GitHub's deployment record**
  (`Production – easyway-lms: success`) — *not* by HTTP status codes. (A nonexistent admin route
  also returns 401/307 because a blanket gate answers first; that "proof" proved nothing.)

### 5.8 Diagnose & repair — fixing DATA from the console, with an algorithm  (`lib/diagnose.ts`, `lib/diagnose-server.ts`)

**The question it answers.** "A student complains. Can the console find the cause and fix it — without AI?" Yes, for one
class of problem, and knowing where the line is matters more than the tool:

| Kind of problem | Can a button fix it? |
|---|---|
| **Data / state** — a payment that reached Paystack but not our database, a missing student ID, a stale cached answer | **Yes.** The cause is a fact in the database; the repair is an idempotent write. This is what the tool does. |
| **Code** — a wrong rule, a broken query | **No.** That needs a deploy. A panel that patches production logic on click is an outage waiting for a mistake. The console can *find and explain* it (incidents, the map, the witness); the fix ships through review and CI. |
| **Config / a misbehaving feature** | A *switch* — a per-tenant feature flag — is the honest tool: turn the feature off now, fix it properly after. (Not built yet.) |

**The pattern (worth being able to say in one breath):** *detect → diagnose → propose → approve → repair → **verify** → audit.*
It is a **runbook automation**: what an on-call engineer does by hand, turned into rules and whitelisted actions.

**Diagnose — a rule engine, not a model.** `diagnose(facts)` runs a list of small pure rules over a plain bundle of facts about
one student and returns findings, each with its *evidence* so a person can check the reasoning. Rules exist only for causes that
have **already happened** in this codebase (a missed webhook, a code-less student, a tenant-less row). Two consequences:
it is unit-testable (facts in, findings out), and it is honest — an empty result says *"these 5 checks came back clean; that is
not the same as nothing being wrong"*. A rule I could not verify against real code (a "no tutor assigned" check — your tutor
logic has named-only tutors, co-tutors and hybrid cases) was **deliberately not written**: a detector that is confidently wrong
is worse than none.

**The headline algorithm — reconcile Paystack against our ledger.** The checkout route never creates a pending payment row, so a
student whose webhook or callback failed leaves *no trace* in the database. So the tool **asks Paystack** (customer by email →
their successful transactions) and diffs by reference against `Payment.stripeSessionId`. Ownership is decided by the metadata *we*
attached at checkout, not by email — a parent paying for two children from one address must not have one child's payment offered
to the other (`belongsToStudent`). A receipt reference the student sends can be checked too. Repair = `verifyPaystackTransaction(reference)`,
which re-asks Paystack and records only money Paystack confirms, and is **idempotent by reference**.

**Repair — five rules, all enforced in `runRepair` and tested:**
1. **Re-derive before acting.** The browser's request is treated as a *request*, not an instruction. The server rebuilds the facts
   and only proceeds if the diagnosis *still* offers exactly that repair. A stale click, a second admin, or a forged request all end at
   "nothing to do".
2. **Idempotent** — keyed on the Paystack reference; issuing a student ID never overwrites one.
3. **Verify after** — re-run the same rules; report honestly *"done, but it is still there"* rather than a green tick.
4. **Audited** — who, what, before/after, into the immutable `AuditLog` (best-effort by design, so a logging fault cannot undo a payment record).
5. **Never retried** — a failed step stops and says so. A tool that quietly retries is how one payment is recorded twice.

Plus: a **short whitelist** checked with `hasOwnProperty` (a plain `in` check is true for `"toString"` — a real hole found while
writing the tests), a **per-repair capability** on top of console access (recording a payment needs `payments`), and **no repair
at all** for some findings on purpose — a tenant mismatch needs a person's judgement about *who may see what*, and guessing wrong
is how data leaks between schools.

**Complaint → fix in one click.** A complaint incident carries the reporter's user id; a drift incident's samples carry the student
id. "Diagnose the student this is about" opens the tool already pointed at them.

**Honest limits.** Repairs are on-demand, not automatic — a person clicks. Only two repairs exist. The Paystack check needs the
student to have paid with the email on their account or a reference someone can supply. The rules cover what has already gone wrong;
a *new* kind of fault is invisible until a rule is written for it — which is the loop: every real incident should end with either a
fix or a new rule.

---

## 6. Failure walk-throughs (rehearse these)

**Neon suspended overnight; first student opens the app.** Query fails `P1001` → cold-start retry
absorbs it with backoff (safe: nothing reached the server) → the student sees a slightly slow first
load, not an error page.

**Paystack starts returning 503.** `guardedFetch("paystack")` counts each 5xx but hands callers the
normal response; after 4 in a row the breaker opens → checkout instantly answers
*"Online payment is having trouble… Nothing has been charged"* instead of hanging → after 15 s one
probe goes through → if it succeeds, payments resume by themselves. A customer's *declined card* (a
4xx) never counts.

**Groq goes slow (not down).** Without a deadline the request would hang to 60 s and the breaker
would never know. With the 50 s deadline it becomes a counted failure; after 5, calls to Groq fail
fast (returning `null`, which callers already handle) and the app falls back or degrades, while
payments and every other provider are unaffected (separate breakers).

**"I paid and it's still locked."** Open Mission Control → Diagnose & fix → search the student → **Deep check**: if Paystack holds a payment we never recorded, one confirmed click records it and re-checks. Otherwise, open the student's Remote View → the composed verdict lists every
reason and what lifts it (perhaps *photo missing*, not payment) → `AccessSnapshot` shows *since when*
and what their screen last reported. If their browser is acting on stale data, the witness has
already raised a `stale` drift incident.

**A cron job hangs.** It is abandoned at its cap (`timed_out`), an incident is recorded on route
`cron:<job>`, the security-holders get a de-duplicated alert, and every job in *other* lanes has
already run.

**A developer adds a table / a cron job / a route that computes payment status.** New table not in
the tenant registry → the test suite fails. New cron job not in `CRON_PLAN` → the test fails. Route
that re-derives payment logic → the drift guard fails CI. *That is the design goal: the mistake
cannot reach production quietly.*

---

## 7. What to say about "why not X?"

- **Why a monolith, not microservices?** ~400 students, a small team. Microservices convert
  *in-process function calls* into *network calls that can fail*, and everything in §5 is the
  toolkit you'd need to survive that. A modular monolith on serverless gives independent scaling per
  route already, without a distributed-systems tax we don't yet need. The seams (libs with pure
  rules, the registry, the lanes) are where you'd cut later.
- **Why one shared database for all tenants?** Cheapest to operate and to migrate. The price is
  blast radius and noisy neighbours — which is why isolation is enforced in two layers and why
  RLS is the planned second one.
- **Why enforce in a Prisma extension rather than only in Postgres?** Ergonomics and testability;
  it is the *inner* layer. RLS is the outer one. Neither alone is trusted.
- **Why per-instance breaker state?** Simplicity, and for *protecting a dependency* it is enough:
  each warm instance learns for itself within a few calls. A shared breaker (Redis) would be more
  exact and adds a dependency to the failure path. Console numbers are labelled "this instance".
- **Why polling, not websockets, for the console?** Serverless functions are short-lived; a held
  socket needs a different platform. 10 s polling of cheap indexed counts is enough for a human.

---

## 8. Honest limits — what NOT to claim

State these before you're asked; it builds credibility.

1. **Rate limiting is per edge instance** — a speed bump, not a wall. Real fix: shared counter.
2. **Postgres row-level security is designed but not applied.** Isolation today is the Prisma
   extension only. Raw SQL bypasses it.
3. **Admin 2FA is built but enforcement is off** (not every admin is enrolled).
4. **Backups (as last verified early September):** the nightly encrypted `pg_dump` artifact (90-day
   retention) is working; the off-provider **restic tier was not configured**, the **object-storage
   backup** (passport scans, recordings, materials) had **no backup job configured**, and the restore
   drill was blocked on that. Re-verify before claiming otherwise.
5. **Circuit-breaker and bulkhead state is per instance**, not fleet-wide.
6. **Not yet guarded:** the admin assistant's Anthropic SDK *stream* (it is not a plain `fetch`),
   Azure speech scoring, LiveKit, SMTP.
7. **Timeouts abandon work; they don't cancel it.** Only calls with an `AbortSignal` truly stop.
8. **The backend map is a static regex reading** — silent about dynamic access.
9. **The witness has no data until students load the new build**; installed PWAs may serve old JS
   for a while. An empty console right after a deploy is expected, not proof of health.
10. **Two source trees** (`src/` and `prototype/src/`) exist and have diverged; only `prototype/`
    ships. Every new file must be mirrored or the build can fail.
11. **No formal SLOs / alerting thresholds yet.** There is observability; there is no error budget.
12. **Single region, single primary database.** Strong consistency by construction, and a single
    point of failure. There is no read replica and no failover beyond Neon's own.

---

## 9. Questions an advanced engineer will ask — and the short answers

1. **How do you prevent one tenant reading another's data?** Two layers by design: a Prisma
   extension that fails closed (throws with no tenant in context) and stamps nested creates, plus
   RLS as the outer layer (designed, not yet applied). A registry test fails the build if any table is
   unclassified.
2. **How does the tenant reach a query five modules deep?** `AsyncLocalStorage`, filled by the auth
   gate via a synchronously-installed *mutable holder* — because `enterWith` doesn't propagate
   upward across an `await`.
3. **How do you avoid exhausting Postgres connections on serverless?** Pooled connection string, and
   the Prisma client cached on `globalThis` so a warm instance reuses one pool. Migrations/dumps use
   the direct string.
4. **What is your consistency model?** One Postgres primary → strongly consistent reads/writes.
   Drift we *do* have is between the database and *client-side* state (a stale PWA) — which the
   witness detects and the 30 s poll heals.
5. **How do payments stay correct?** One ledger (FIFO per-level `TuitionCharge`), one pure verdict
   function, a CI guard against re-derivation, verification by reference, and no blind retries.
6. **Is anything retried unsafely?** No: cold-start retry only on `P1001` (connection never made);
   payments are never retried.
7. **What happens if the incident DB write itself fails?** Bulkhead + breaker: writes stop after 4
   failures, the error is still in the platform log, and recording resumes by itself. Observability is
   allowed to be briefly blind; it must never take down what it observes.
8. **How do you know your UI matches your database?** The witness reconciliation loop (§5.2).
9. **How do you deploy schema changes safely?** Hand-written idempotent SQL, verified to have run
   *before* it is marked applied; the build never migrates (`build` = `prisma generate && next build`).
10. **What is your RPO/RTO?** Row-level undo for the common case (soft delete + before-images);
    nightly encrypted dumps for the rest; Neon point-in-time recovery for a real restore. There is no
    formal target yet (§8.11).
11. **Why should I trust your tests?** Injected clocks make time-dependent failure handling testable;
    "drift" tests read the source to catch unscheduled/unclassified additions; anything that writes was
    also verified against the real database — which caught two bugs the unit tests missed.
12. **Where would it break first at 100× load?** In order: the daily cron's single function (now
    laned), per-instance rate limiting, connection pooling limits on the Neon plan, N+1 queries in
    list routes, and live-class media (LiveKit) — *not* Postgres row counts.

---

## 10. Where to read the code

| Topic | Start at |
|---|---|
| Client onion | `src/lib/prisma.ts` |
| Soft delete / audit / write cap | `src/lib/prisma-guard.ts`, `src/lib/audit-context.ts` |
| Tenant isolation | `src/lib/tenant/{registry,context,extension}.ts`, `tenant/isolation.test.ts` |
| Front door | `src/proxy.ts`, `src/lib/admin-roles.ts` |
| Access verdict | `src/lib/student-access.ts`, `src/lib/access.ts`, `src/lib/portal-verdict.ts` |
| Witness | `src/lib/portal-witness.ts`, `src/lib/usePortalWitness.ts`, `src/app/api/student/witness/route.ts` |
| Incidents | `src/lib/incidents.ts`, `src/lib/capture-error.ts`, `src/instrumentation.ts` |
| Resilience | `src/lib/resilience.ts`, `src/lib/guarded-fetch.ts`, `src/lib/cron-lanes.ts` |
| Console | `src/components/developer/*`, `src/app/api/admin/developer/*` |
| Backend map | `src/lib/backend-graph.ts`, `scripts/build-backend-graph.ts` |
| Guards | `scripts/check-payment-gate-drift.mjs`, `.github/workflows/ci.yml` |
| Runbook | `docs/SECURITY.md`, `docs/DEPLOY.md` |

---

## 11. A note on the road from here to "building your own database"

Every idea above has a lower-level twin worth studying, and they are the honest on-ramp to storage
engines and consensus:

| In this system | The database-internals idea it rhymes with |
|---|---|
| `AuditLog` (append-only, before-images, immutable) | the **write-ahead log** / event log |
| Row-level undo from before-images | **MVCC** / point-in-time recovery |
| `AccessSnapshot` (a derived, per-student read model) | **materialised view / CQRS read model** |
| Idempotency conditions on retry; payment references | **exactly-once** semantics, idempotency keys |
| Incident fingerprint + dedupe | content-addressed dedupe; **hash-based** storage |
| Breaker single-probe half-open | **leader election / probing** in failure detectors |
| The witness (believed vs observed state) | **anti-entropy / read repair** |
| Bulkhead bounded queues | **backpressure** and admission control |
| Neon suspend/resume | separation of **compute and storage** |

A sensible order for a from-scratch database project: an append-only log with checksums → an
in-memory index rebuilt from it → an LSM-tree (memtable, SSTables, compaction) → snapshots and
recovery → replication with a leader → Raft. Use EasyWay as the *workload* that tells you what the
database must actually do (idempotent writes, tenant isolation, audit) — and keep production data
off it until it has survived a real fault-injection suite.
