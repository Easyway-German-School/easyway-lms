# Security and recovery

This is the document to open on a bad morning. It is written to be followed
when something has already gone wrong and nobody is thinking clearly, so the
procedures come before the explanations.

---

## 1. What we are actually protecting against

Ranked by how likely each is to be the thing that happens, not by how dramatic
it sounds. The order matters, because it is the reverse of where most effort
usually goes.

| # | Scenario | Likelihood | What covers it |
|---|---|---|---|
| 1 | Somebody deletes the wrong record | **High** | Soft delete + the activity trail, `/admin/security` |
| 2 | A bad script or bulk import mangles many rows | **High** | Blast-radius guard, before-images, nightly dump |
| 3 | A provider account is lost (card declined, email compromised, suspension) | **Medium** | Off-provider encrypted backup at a different vendor |
| 4 | An admin password leaks | **Medium** | Rate limiting, capability gates, the trail, secret rotation |
| 5 | A migration drops a column on deploy | **Medium** | Nightly dump, Neon point-in-time restore |
| 6 | Neon loses the database | **Very low** | Neon PITR, then the off-provider dump |

Scenarios 1 and 2 are handled by *undo*, not by backups. Restoring the whole
database to recover one student would throw away every payment, mark and
message recorded since — the cure would cost more than the disease. That is
what the activity trail exists for.

---

## 2. Emergency procedures

### 2.1 Somebody deleted a record and it needs to come back

1. Open **`/admin/security`** (super admin only).
2. Tick **Only what can be put back**, and filter by record type if the list
   is long.
3. Find the entry. Each line names the record, who removed it, when, and from
   which address.
4. Press **Put back**.

Restore order matters when several things went at once. A row can only be
re-created if what it points at still exists, so restore the parent first —
the **User**, then the **Student**, then their payments and marks. If a
restore is refused with a foreign-key message, that is what it means.

Nothing here needs a backup, and nothing else in the school is affected.

### 2.2 A bad script mangled a lot of rows

1. Find the entry in `/admin/security`. Bulk writes are recorded with the row
   count and marked `alert`.
2. If it was a delete, **Put back** restores every row in that one statement.
3. If it was an update, the before-image is on the entry and the correction is
   a deliberate, field-by-field decision — updates are not one-click
   reversible on purpose, because "put it all back" is usually wrong for an
   update that was partly correct.

### 2.3 The database is damaged or gone

Two routes. Try them in this order.

**Neon point-in-time restore — minutes, and the first thing to try.**

1. Neon console → the project → **Branches** → **Restore**.
2. Pick a timestamp *before* the damage.
3. Neon restores in place. Confirm the app is reading correctly.

> **Check your retention window now, not later.** Neon's history retention is
> a paid-plan setting and the free window is short. Whatever it is set to is
> the maximum age of damage this route can undo. Write the number here:
>
> **Our Neon retention window: ______ days**

**Restore from the off-provider dump — an hour, and works when the Neon
account itself is the problem.**

```bash
# 1. What have we got?
export RESTIC_REPOSITORY=...      # the backup repo
export RESTIC_PASSWORD=...        # from the password manager
export AWS_ACCESS_KEY_ID=...      # the backup bucket key
export AWS_SECRET_ACCESS_KEY=...
restic snapshots --tag database

# 2. Pull the one you want
restic restore <snapshot-id> --target ./recovery

# 3. Put it into a NEW empty database first. Never restore over a live one
#    that might still hold rows the dump does not.
pg_restore --dbname "$NEW_DATABASE_URL" --no-owner --no-privileges \
           --exit-on-error ./recovery/easyway-*.dump

# 4. Point the app at it: change DATABASE_URL and DIRECT_DATABASE_URL in
#    Vercel, then redeploy.
```

### 2.4 Files are gone (photos, materials, recordings)

The mirror keeps deletions rather than copying them. Files removed from R2 are
in the dated archive folder, not lost.

```bash
# What was removed, and when
rclone lsf "DST:<backup-bucket>/archive/"

# Put a day's worth back
rclone copy "DST:<backup-bucket>/archive/2026-08-03" "SRC:<r2-bucket>"
```

### 2.5 An admin account is compromised

In this order, and do not stop halfway:

1. **Take their access away** — `/admin/staff`, revoke the admin role.
2. **Read what they did** — `/admin/security`, filter by that person. This is
   why the trail is append-only and why Postgres refuses to let anything edit
   it: an attacker with database access still cannot erase their own history.
3. **Rotate every secret below.** Assume anything the account could read is
   now public.
4. **Undo the damage** — restorable entries in the trail.

---

## 3. Secrets

### 3.1 Backing up the secrets themselves

The application cannot be rebuilt from data alone. Forty-plus environment
variables stand between a restored database and a working school, and if
`.env.local` and the Vercel dashboard are lost on the same day, nothing above
helps.

Keep a copy in a password manager (Bitwarden or 1Password), or encrypted into
the repository with `sops` + `age`. Whichever — it must live somewhere that
does not depend on the Vercel, Neon or Cloudflare accounts.

### 3.2 Rotate immediately if exposed

| Secret | Why it is urgent |
|---|---|
| `DIRECT_DATABASE_URL`, `DATABASE_URL` | Full read/write access to every student record |
| `NEXTAUTH_SECRET` | Forges any session, including a super admin's |
| `RESTIC_PASSWORD` | Decrypts every backup, and losing it makes them unreadable forever — this one cannot be reset, only replaced going forward |
| `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY` | Money |
| `STORAGE_S3_*`, `RECORDING_S3_*` | Passport scans and recorded lessons |
| `CRON_SECRET` | Lets someone report backups that never happened, silencing the alarm in §4 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Billed by the token |

---

## 4. The backup system

Three jobs, all on GitHub Actions rather than Vercel — a Vercel function has
60 seconds and a 4.5MB response ceiling, and a dump that grows with the school
will breach both eventually, on an ordinary day, with no warning.

| Job | When | What it does |
|---|---|---|
| `backup-database.yml` | 01:30 UTC daily | `pg_dump` → encrypted restic snapshot at a second vendor |
| `backup-objects.yml` | 02:30 UTC daily | `rclone` mirror of R2, deletions preserved |
| `restore-drill.yml` | 3rd of the month | Restores the newest backup into a scratch Postgres and counts every table against production |

The drill is the one that makes the others trustworthy. A backup nobody has
restored is a rumour.

The app watches for **silence**, not for errors: if no successful run is
recorded within 26 hours, the daily cron raises a critical alert to super
admins. This is deliberate — the way backups fail is by quietly stopping, and
a job that has not run produces no error to notice.

### 4.1 Required GitHub secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `DIRECT_DATABASE_URL` | The **direct** Neon string, not the pooled one |
| `RESTIC_REPOSITORY` | e.g. `s3:s3.us-west-004.backblazeb2.com/easyway-backups` |
| `RESTIC_PASSWORD` | Long random string. **Store it in the password manager before the first run** |
| `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | Backup bucket credentials |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_REGION` / `BACKUP_S3_PROVIDER` | Backup bucket location |
| `BACKUP_OBJECTS_BUCKET` | Bucket for the file mirror |
| `STORAGE_S3_ENDPOINT` / `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET` / `STORAGE_S3_BUCKET` | The R2 source, same values as the app |
| `APP_BASE_URL` | e.g. `https://lms.easywayabroad.com` |
| `CRON_SECRET` | Same value as in Vercel |

**The backup bucket must be at a different vendor from R2.** Backblaze B2 is
the cheap default — 10GB free, then about $6/TB/month. A backup in the same
account as the thing it backs up dies in the same compromise, the same
declined card, the same suspension. That is the entire point of the exercise.

---

## 5. Data protection

The backups and before-images contain passport scans, addresses and payment
records — the same personal data as the live database, gathered in one place.
Under Nigeria's NDPA that makes the backup a regulated store, not an exemption.

- restic encrypts client-side, so the storage provider only ever holds
  ciphertext.
- Backups age out automatically: 14 daily, 8 weekly, 12 monthly.
- The activity trail's before-images are personal data. Prune them on the same
  clock as the student records they describe.

Pruning the trail is deliberately awkward, because a trail that is easy to
clear is not a trail. Postgres refuses the delete unless the session opts in:

```sql
BEGIN;
SET LOCAL easyway.audit_prune = 'on';
DELETE FROM "AuditLog" WHERE "at" < now() - interval '24 months';
COMMIT;
```

Treat that as a two-person operation.

---

## 6. Go-live checklist

Before the first real student signs in:

- [ ] Set the Neon history retention window, and write it into §2.3 above
- [ ] Add every GitHub secret in §4.1
- [ ] Run `backup-database.yml` by hand once and confirm it reports on `/admin/security`
- [ ] Run `restore-drill.yml` by hand once — **do not trust a backup you have not restored**
- [ ] Save `RESTIC_PASSWORD` and all env vars to the password manager (§3.1)
- [ ] Confirm `ALLOW_DEV_ROUTES` is **not** set in Vercel
- [ ] Delete the demo admin `admin@easyway.test` — its password is in the repository
- [ ] Change every other seeded or test password
- [ ] Confirm `CRON_SECRET` and `NEXTAUTH_SECRET` are fresh values, not the development ones
- [ ] Apply the migration: `npx prisma migrate deploy`
- [ ] Walk the app in Report-Only, read the console for CSP violations, then set `CSP_ENFORCE=true` (§7)

---

## 7. Turning on the content security policy

It ships in `Report-Only` because a policy that is wrong by one origin does not
degrade gracefully — it blanks the page or kills the payment popup for
everybody at once.

1. Deploy as-is. Sign in, take a payment, join a live class, upload a photo,
   play a recording.
2. Watch the browser console for `Content-Security-Policy-Report-Only`
   violations.
3. Add any legitimate origin to `contentSecurityPolicy()` in
   [`src/middleware.ts`](../src/middleware.ts).
4. When a full pass produces no violations, set `CSP_ENFORCE=true` in Vercel.

---

## 8. What is deliberately not built yet

Stated plainly so nobody assumes cover that does not exist.

| Gap | Why it matters | The fix when you want it |
|---|---|---|
| **No two-factor auth on admin accounts** | The single biggest remaining hole. A leaked admin password is a leaked student database, passport scans included. | TOTP with `otplib`, enforced for any account holding `payments` or `security` |
| **Rate limiting is per-isolate** | In-memory on the edge, so it slows a single attacker but does not stop a distributed one | Shared counter in Upstash Redis; swap inside `hit()` in `src/middleware.ts` |
| **No error tracking** | A failure nobody sees is a failure nobody fixes | Sentry, or self-hosted GlitchTip |
| **Soft-delete does not filter nested reads** | `include: { payments: true }` will return soft-deleted children; top-level reads are filtered correctly | Filter in the `include`, or query the child model directly |
| **No alert on unusual sign-in location** | The trail records the IP but nothing reads it | A daily job comparing each admin's addresses against their history |

---

## 9. How the protections work

For whoever maintains this next.

- **[`src/lib/prisma-guard.ts`](../src/lib/prisma-guard.ts)** — a Prisma client
  extension every query passes through. Rewrites `delete` to `deletedAt` on 12
  models, records before-images, and refuses a `deleteMany` with no `WHERE` or
  one touching more than 200 rows. Wired in
  [`src/lib/prisma.ts`](../src/lib/prisma.ts) so it cannot be forgotten at a
  call site.
- **[`src/lib/audit-context.ts`](../src/lib/audit-context.ts)** — carries the
  actor on the async context, set once inside `requireCapability()` so every
  admin route is covered, including ones written later.
- **The `AuditLog_immutable` trigger** — Postgres refuses to update or delete
  an audit row. The application enforces this too, but the application is the
  thing most likely to be compromised, so the rule that counts lives in the
  engine.

### Working around the guard, when you genuinely need to

A seed, a port or a retention job legitimately writes without a `WHERE`:

```ts
import { runWithAuditActor } from "@/lib/audit-context";

await runWithAuditActor({ source: "script", allowUnscopedWrites: true }, async () => {
  await prisma.someModel.deleteMany({});
});
```

If you find yourself reaching for this in a route handler, that is the guard
doing its job. Narrow the filter instead.
