# 001 — Tenant isolation

Turns a single-school LMS into something that can hold more than one school
without either being able to see the other.

**Nothing in this folder has been run.** It is written, checked and staged
against a live database holding real students and real payments, and the
decision to run it is a human one.

## Why it is not already applied

The schema change and the database change are one operation split across two
systems, and the app is broken in the gap between them. `npm run build` runs
`prisma generate`, so once `schema.prisma` carries `tenantId` the generated
client selects that column on every query — against a database that does not
have it yet, that is an error on **every read in the app**, not a degraded
feature.

So the schema edit is deliberately left unapplied. Run the steps below in one
sitting, or run none of them.

## Order

**1. Add the columns to the schema** (local, reversible)

```bash
node scripts/add-tenant-columns.mjs --write
```

Adds `tenantId` to 44 models — `Branch` already has it. Review
`git diff prisma/schema.prisma`, then `npx prisma generate`.

**2. Push the columns to the database**

```bash
npx prisma db push
```

`db push`, not `migrate dev` — this project has never used the migrations
table and `migrate dev` would try to reconcile a history that does not exist.
Adding nullable columns takes no lock worth worrying about at this row count.

**3. Backfill** — `01_backfill.sql`

Creates the `easyway` tenant and assigns every existing row to it. Idempotent.
Until this runs, every existing row has `tenantId = NULL` and is invisible to
any tenant-scoped query.

**4. Verify before going further**

```sql
SELECT COUNT(*) FROM "Student" WHERE "tenantId" IS NULL;  -- must be 0
SELECT COUNT(*) FROM "Payment" WHERE "tenantId" IS NULL;  -- must be 0
```

At this point isolation is enforced by the Prisma extension
(`src/lib/tenant/client.ts`) and the app works exactly as before. **This is a
sensible place to stop and live for a while.** Steps 1–4 deliver most of the
protection at a fraction of the risk.

## 5. Row-level security — `02_rls_DANGEROUS.sql`

Named that way because running it against the current app **takes the site
down instantly and completely.**

The policy compares `"tenantId"` against `current_setting('app.tenant_id',
true)`. The app never sets that. Unset, it is NULL, `"tenantId" = NULL` matches
nothing, and every query in the application returns zero rows. Not an error —
just an LMS where every student has vanished. `FORCE ROW LEVEL SECURITY` means
the role Prisma connects as does not escape it either, which is the point of
including it and also why there is no accident-shaped recovery.

Two things must be true first:

**a. Every request sets the tenant, inside a transaction.** Neon's pooler runs
in transaction mode, so a session-level `SET` does not survive to the next
query. It has to be `SET LOCAL` within the same transaction as the work:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
  // ...queries on tx...
});
```

That is a real change to how every route talks to the database, and it is the
bulk of the work in this step.

**b. A role that can bypass it exists**, for migrations, the nightly cron and
the backup runner:

```sql
CREATE ROLE easyway_admin WITH LOGIN BYPASSRLS PASSWORD '...';
```

Point `DIRECT_DATABASE_URL` at that role and leave `DATABASE_URL` on the
restricted one.

**Rollback**, if it goes wrong:

```sql
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

Have that in a psql window before you run step 5, not after.

## What this does not cover

`tenant-portal/` is a separate app with a separate database and no
cross-tenant authorization at all. None of this reaches it. It should be
deleted and rebuilt inside this data plane rather than fixed in place.
