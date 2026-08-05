# Deploying Easyway LMS to Vercel

This is the runbook. Follow it top to bottom and the app comes up; skip a step
and the failure it causes is named next to it.

Two things changed to make this possible, and both are worth understanding
before you start, because they are the two that will bite:

**The database is Postgres now, not SQLite.** A serverless function gets a
read-only filesystem and a container that is thrown away after the request. A
file-backed database there is not slow, it is absent — every write fails, and
the ones that seem to succeed disappear with the container.

**Uploads go to an object bucket, not `public/uploads`.** Same reason. A student
photo written to disk on Vercel either errors or vanishes silently, and silently
is worse: nobody finds out until somebody goes looking for the passport scan.

---

## Before you start

Three accounts. All have free tiers that comfortably fit a school of this size.
**You need to create these yourself** — sign-ups and payment details are not
something to hand to an agent.

| What | Why | Free tier |
|---|---|---|
| [Vercel](https://vercel.com) | Hosting | Hobby is free; see the cron note below |
| [Neon](https://neon.tech) *(or Supabase)* | Postgres | 0.5 GB, plenty here |
| [Cloudflare R2](https://dash.cloudflare.com) *(or Backblaze B2)* | File storage | 10 GB, and no charge to serve |

R2 is the recommendation over S3 for one specific reason: on this workload the
bill is bandwidth, not gigabytes — students rewatching class recordings — and R2
charges nothing for egress. The same bucket serves uploads and recordings.

---

## 1. Create the database

In Neon, create a project. It gives you two connection strings; you need both.

- **Pooled** (has `-pooler` in the hostname) → `DATABASE_URL`
- **Direct** → `DIRECT_DATABASE_URL`

They are not interchangeable. The app uses the pooled one because every
serverless request opens its own connection, and a few hundred students on a
Monday morning will exhaust a Postgres connection limit in under a minute
without a pooler in front. Migrations use the direct one because they cannot run
through a pooler in transaction mode.

Pick the region closest to Nigeria — Frankfurt (`eu-central-1`) is the usual
answer, and it should match the Vercel region in step 4.

## 2. Create the bucket

In R2, create a bucket. Note the **account ID** (it is in the endpoint URL) and
create an **API token** with object read/write.

```
STORAGE_S3_BUCKET=easyway-lms
STORAGE_S3_REGION=auto
STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_S3_ACCESS_KEY=<token access key>
STORAGE_S3_SECRET=<token secret>
```

**Then add a CORS rule to the bucket**, or every upload fails with a 403 that
looks like a credentials problem and is not. The browser uploads files straight
to the bucket — it has to, because a request body through Vercel is capped at
4.5 MB and a lesson PDF is routinely larger — and the bucket has to be told that
is allowed:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Leave `STORAGE_PUBLIC_BASE_URL` **unset**. Unset means uploaded files are served
through `/api/files`, behind the session check. Setting it makes every stored
file world-readable at a guessable URL, and these files include ID and passport
scans.

## 3. Fill in the schema

From your machine, with `DIRECT_DATABASE_URL` pointing at the new database:

```bash
npm run db:migrate
```

Then, if you want the existing development data — branches, courses, cohorts,
community spaces, everything set up by hand since July — carry it across:

```bash
npm run db:port
```

That reads `prisma/dev.db` and copies it in. It is safe to re-run: rows already
present are skipped, so a run that dies halfway can just be started again. It
prints a per-table count at the end; anything it could not port is named.

If you would rather start clean, skip it and run the seed scripts in `scripts/`
instead.

## 4. Create the Vercel project

Import `Easyway-German-School/easyway-lms` from GitHub, then — and this is the
one people miss:

> **Root Directory: `prototype`**

The Next.js app is not at the repo root. Without this the build fails
immediately with "No Next.js version detected".

Everything else is detected. The build command already runs `prisma generate`
before `next build`, which is what stops Vercel shipping a stale Prisma client
built against the old SQLite schema.

Set the region to Frankfurt (`fra1`) under Settings → Functions, to match the
database. Every millisecond between the function and Postgres is paid on every
query.

## 5. Environment variables

Paste these into Settings → Environment Variables. `prototype/.env.example` is
the annotated version of this list; below is what production needs.

**Required — the app does not work without them:**

```
DATABASE_URL             pooled Postgres string
DIRECT_DATABASE_URL      direct Postgres string
NEXTAUTH_SECRET          openssl rand -base64 32 — a NEW one, not the dev value
NEXTAUTH_URL             https://your-domain.com
STORAGE_S3_BUCKET        \
STORAGE_S3_REGION         |
STORAGE_S3_ENDPOINT       > from step 2
STORAGE_S3_ACCESS_KEY     |
STORAGE_S3_SECRET        /
CRON_SECRET              any long random string; see step 6
```

`NEXTAUTH_SECRET` must be a fresh value. It signs session cookies, so a secret
that has ever been in a repo or a shared file lets anyone mint a session for any
account, including a super admin.

**Strongly recommended:**

```
ANTHROPIC_API_KEY        the admin assistant, essay grading, recommendations
PAYSTACK_SECRET_KEY      tuition checkout — without it students cannot pay
PAYSTACK_CALLBACK_URL    https://your-domain.com/api/paystack/callback
EMAIL_PROVIDER           zoho | gmail — plus SMTP_USER, SMTP_PASS, SMTP_FROM
VAPID_PUBLIC_KEY         \
VAPID_PRIVATE_KEY         > push notifications; copy from .env.local
VAPID_SUBJECT            /
LIVEKIT_URL              \
LIVEKIT_API_KEY           > the live classroom
LIVEKIT_API_SECRET       /
```

**Do not copy `OLLAMA_BASE_URL`.** It points at `localhost:11434`, which on
Vercel is the serverless container — there is no model in there. The app now
detects and ignores a localhost model URL in production rather than waiting on a
connection that will never open, but leaving it out is cleaner.

Everything not listed degrades on purpose: the feature turns itself off and says
so, rather than crashing. `.env.example` says what each one costs you.

## 6. The scheduler

Five periodic jobs — the email queue, fee reminders, payment warnings, recording
reconciliation, retention — all run from one endpoint, `GET /api/cron/tick`.
One endpoint rather than five because Vercel Cron only ever issues a GET, and
the individual routes keep GET as a read-only status view; a cron pointed
straight at them would have returned 200, looked healthy, and sent nothing.

`vercel.json` schedules it **once a day at 06:00 UTC**, because that is what the
Hobby plan permits. That is fine for reminders and far too slow for an email
queue, which wants to drain every few minutes.

Two ways to fix that:

- **Vercel Pro** — change the schedule in `vercel.json` to `*/15 * * * *`.
- **An external scheduler, free** — [cron-job.org](https://cron-job.org) or a
  GitHub Actions workflow hitting the URL every 15 minutes:

  ```
  GET https://your-domain.com/api/cron/tick
  Authorization: Bearer <CRON_SECRET>
  ```

The endpoint refuses everybody while `CRON_SECRET` is unset. That is deliberate:
an open endpoint that drains a mail queue is a way to get the school's domain
blacklisted.

Retention only *reports* what it would delete unless `RETENTION_AUTO=true`. Look
at the number it reports before you set that.

## 7. After the first deploy

Check these in order. Each one fails differently, so the first that breaks tells
you which step above to revisit.

1. **Sign in.** Fails → `NEXTAUTH_SECRET` / `NEXTAUTH_URL`, or the database is
   empty because step 3 did not run.
2. **Open the admin dashboard.** Loads with real counts → Postgres is connected.
3. **Upload a student photo.** 403 → the bucket's CORS rule (step 2). The image
   should come back through `/api/files/...`.
4. **Upload a course material over 5 MB.** This is the one that would have
   failed before the change; it is worth doing specifically.
5. **Hit `/api/cron/tick`** with the bearer token. It returns a per-job result,
   so a failure names itself.
6. **Start a live class** as a tutor, if LiveKit keys are set.

---

## Things this does not solve

Stated plainly so they are not discovered later:

- **Local development now needs Postgres too.** SQLite is gone from the schema;
  Prisma cannot hold two providers at once. Point `.env.local` at a Neon
  development branch — they are free and it removes the "worked on my machine"
  class of bug entirely. Until you do, the local app will not start.
- **`prisma/dev.db` is still in the repo folder** and is still the only copy of
  the old data. Do not delete it until `npm run db:port` has run and you have
  checked the counts.
- **Class recording needs the bucket and LiveKit egress**, and the reconcile job
  needs a scheduler that fires more than daily to be useful.
- **`/api/files` checks that you are signed in, not that this file is yours.**
  That is a floor, not a ceiling — it shuts out the open internet, which is the
  threat that mattered here. A per-file ownership check needs an `Upload` table
  mapping keys back to owners, and is worth building the day the school stores
  something one student must not see from another.
