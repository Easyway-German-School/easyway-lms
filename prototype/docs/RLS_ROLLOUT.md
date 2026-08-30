# Row-level security — rollout runbook

**Status: prepared, NOT enabled.** `prisma/manual/001_tenant_platform/02_rls_DANGEROUS.sql`
exists and is deliberately unrun. This document is how to turn it on safely.

RLS is the *outer* of two isolation layers. The inner one — the Prisma
extension in `src/lib/tenant/client.ts` — already filters every query that goes
through Prisma, and it works. RLS adds a wall the database itself enforces, so
raw SQL, a `psql` session, or a future service that talks to Neon directly
cannot read across tenants either. It is defence-in-depth, not a functional gap
a customer would hit.

## Why it is dangerous to just run

The policy is `USING ("tenantId" = current_setting('app.tenant_id', true))`.
`current_setting(..., true)` returns `NULL` when unset, and `"tenantId" = NULL`
matches **no rows**. That failure direction is correct and intentional — an
unidentified caller sees nothing.

But it means: **the moment RLS is enabled, every query whose transaction has not
run `SET LOCAL app.tenant_id = '<id>'` returns zero rows.** The app does not do
that today. Enabling the SQL as-is would take the live portal — 220 real
students — to blank pages instantly.

## Prerequisites (do these first, in order)

### 1. Make the Prisma client set the GUC per transaction

The tenant extension in `src/lib/tenant/client.ts` currently scopes in
JavaScript. It also needs to push the tenant id down to Postgres for the
duration of each query/transaction:

```ts
// inside the extension's $allOperations / query wrapper, once a tenantId is known:
await prisma.$executeRawUnsafe(
  `SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, "''")}'`,
);
```

`SET LOCAL` is transaction-scoped, so it must run inside the same interactive
transaction as the query. For Prisma that means wrapping tenant-scoped work in
`prisma.$transaction()` and issuing the `SET LOCAL` as its first statement, or
using a connection-pinned client. This is the real engineering work; budget for
it.

`guardedPrisma` (the operator console, the nightly meters) connects as a role
that must be **exempt** — either a `BYPASSRLS` role, or the policy grants it
explicitly. Confirm which role Neon gives you and which `DATABASE_URL` each
client uses.

### 2. Reconcile the table list

`02_rls_DANGEROUS.sql`'s `tables[]` array has fallen behind the schema by ~40
models. The authority is `TENANT_OWNED_MODELS` in `src/lib/tenant/registry.ts`.
Regenerate the array from that list (every entry, exact PascalCase table names)
before running anything. A tenant-owned table left out of the array is a table
with no wall.

### 3. Every tenant-owned table must actually have a non-null `tenantId`

Run `node scripts/prove-tenant-isolation.mjs` and
`npx tsx scripts/repair-tenant-orphans.ts --dry-run`. A row with `tenantId IS
NULL` becomes invisible to everyone the instant RLS is on — including its own
school. Backfill/repair until zero orphans.

## Rollout

1. **Clone prod to a staging Neon branch.** Neon branching makes this a
   one-click copy with real data volume.
2. Point a staging deploy at it. Apply prerequisite #1 (the `SET LOCAL` change)
   to that deploy only.
3. Run the reconciled `02_rls_DANGEROUS.sql` against staging.
4. Exercise every portal against staging: student dashboard, tutor gradebook,
   admin register, the `/v1` API, the operator console, the nightly
   `/api/cron/tick`. Watch for empty lists and 500s — those are unset-GUC bugs.
5. Only when staging is clean for a full day: schedule a low-traffic window,
   take a backup (`npm run backup`), and run the SQL against production.
6. **Rollback**, if needed, is immediate and total:
   ```sql
   DO $$ DECLARE t text; BEGIN
     FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
       EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
     END LOOP;
   END $$;
   ```

## Do not

- Do not run it against production without steps 1–5.
- Do not change the policy to `USING (true OR ...)` or add an `OR tenantId IS
  NULL` "just to be safe" — that reopens exactly the hole this closes.
- Do not enable it table-by-table in production hoping to limit blast radius;
  a half-covered schema with an app that doesn't set the GUC is broken for the
  covered half and unprotected for the rest.
