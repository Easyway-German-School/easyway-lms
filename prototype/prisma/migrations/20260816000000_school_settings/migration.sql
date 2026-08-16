-- School-wide settings the office edits instead of asking for a deploy.
--
-- One new table and nothing else. No column is added to an existing table, no
-- index is dropped, no data is touched. Applying it early breaks nothing —
-- currently deployed code does not read this table — and applying it late
-- loses nothing, because the screen that writes it simply has nowhere to save
-- until it lands.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- SchoolSetting — a key/value row per school
-- ---------------------------------------------------------------------------
--
-- Key/value rather than a column per setting, because the entire purpose of
-- the screen above it is that a school can change how it runs without a
-- schema change. A column per toggle would put us back in a migration per
-- checkbox within a week.
--
-- "tenantId" is NOT NULL, which differs from most tables carrying that column.
-- A settings row owned by nobody has no meaning, and — more importantly — a
-- UNIQUE over a nullable column does not constrain the rows where it is null:
-- Postgres treats each NULL as distinct, so one school would silently gain a
-- fresh row on every save and read back whichever one the planner reached
-- first.

CREATE TABLE IF NOT EXISTS "SchoolSetting" (
  "id"        TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "value"     JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"  TEXT NOT NULL,

  CONSTRAINT "SchoolSetting_pkey" PRIMARY KEY ("id")
);

-- One row per (school, setting). This is what makes the upsert in
-- src/app/api/admin/settings/route.ts safe to retry.
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolSetting_tenantId_key_key"
  ON "SchoolSetting" ("tenantId", "key");

CREATE INDEX IF NOT EXISTS "SchoolSetting_tenantId_idx"
  ON "SchoolSetting" ("tenantId");

-- Cascade: a school being deleted takes its configuration with it. Guarded
-- because the constraint may already exist from an earlier `db push`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SchoolSetting_tenantId_fkey'
  ) THEN
    ALTER TABLE "SchoolSetting"
      ADD CONSTRAINT "SchoolSetting_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
