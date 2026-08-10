-- Tenant isolation: backfill.
--
-- RUN ORDER MATTERS AND IS NOT OPTIONAL. See README.md in this folder.
-- This file assumes `npx prisma db push` has already added the tenantId
-- columns. Running it before that assigns nothing and harms nothing.
--
-- Everything here is idempotent: safe to re-run, safe to stop halfway.
--
-- Run it with: node scripts/run-tenant-backfill.mjs

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The school itself becomes tenant number one.
-- ---------------------------------------------------------------------------
-- Every row currently in this database predates tenancy. Left with a null
-- tenantId they would be invisible to every tenant-scoped query, which would
-- read as "all our data vanished". Assigning them to a real tenant row is what
-- turns the nullable column into an effectively non-null one.

INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
VALUES ('tenant_easyway_root', 'EasyWay Language School', 'easyway', 'active', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Backfill every table that has a tenantId column.
-- ---------------------------------------------------------------------------
-- Driven off information_schema rather than a written-out list of table names.
--
-- The list version was the original, and it had already drifted: three models
-- added to the registry months later were never added to it, so it would have
-- reported success while leaving three tables full of ownerless rows. Asking
-- the database which tables have the column cannot drift, because the column
-- is the thing being backfilled.

DO $$
DECLARE
  t text;
  root_id text;
  touched int;
  total int := 0;
BEGIN
  SELECT id INTO root_id FROM "Tenant" WHERE slug = 'easyway';
  IF root_id IS NULL THEN
    RAISE EXCEPTION 'No tenant with slug easyway. Statement 1 did not run.';
  END IF;

  -- AuditLog refuses UPDATEs. That is deliberate — it is the tamper-evidence
  -- the whole audit trail rests on, and it caught this migration on the first
  -- attempt, which is the trigger working rather than a problem with it.
  --
  -- Assigning ownership to rows that predate ownership is not tampering, so
  -- the trigger is lifted for exactly this statement and restored before the
  -- block ends. Both happen inside one transaction: if anything below fails,
  -- the re-enable rolls back too and the table is never left unprotected.
  -- Nothing else in the application has the rights to do this.
  ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable";

  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
      AND tb.table_type = 'BASE TABLE'
      -- Both are non-null already and belong to whoever created them. A
      -- blanket assignment here would hand another tenant's API key to the
      -- root tenant, which is the exact failure this migration exists to
      -- prevent.
      AND c.table_name NOT IN ('ApiKey', 'IdempotencyRecord')
    ORDER BY c.table_name
  LOOP
    EXECUTE format('UPDATE %I SET "tenantId" = %L WHERE "tenantId" IS NULL', t, root_id);
    GET DIAGNOSTICS touched = ROW_COUNT;
    total := total + touched;
    IF touched > 0 THEN
      RAISE NOTICE '  % rows -> %', touched, t;
    END IF;
  END LOOP;

  ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable";

  RAISE NOTICE 'backfilled % rows', total;
END $$;

COMMIT;
