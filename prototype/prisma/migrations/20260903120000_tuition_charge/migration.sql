-- The per-level tuition ledger. One row per level a student passes through,
-- with the fee frozen at creation. See the block comment on `model
-- TuitionCharge` in prisma/schema.prisma and src/lib/finance/ledger.ts for how
-- the debit side (charges) and the credit side (payments) are reconciled FIFO.
--
-- Before this, "what a student owes" only ever looked at their CURRENT level's
-- fee, so a promotion silently erased the previous level's shortfall. A student
-- could ride A1 -> B1 on part-payments and finish owing money nobody could see.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, and `migrate deploy` runs on every
-- Vercel build. Never run `prisma migrate dev` against this database. There is
-- no data backfill here — scripts/backfill-tuition-charges.mjs does that as a
-- reviewed, dry-run-first step once the table exists.

CREATE TABLE IF NOT EXISTS "TuitionCharge" (
  "id"            TEXT NOT NULL,
  "studentId"     TEXT NOT NULL,
  "level"         TEXT NOT NULL,
  "amount"        INTEGER NOT NULL,
  "classType"     TEXT NOT NULL DEFAULT 'group',
  "branchName"    TEXT,
  "origin"        TEXT NOT NULL,
  "legacyArrears" BOOLEAN NOT NULL DEFAULT false,
  "waivedAmount"  INTEGER NOT NULL DEFAULT 0,
  "waivedReason"  TEXT,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt"     TIMESTAMP(3),
  "deletedAt"     TIMESTAMP(3),
  "tenantId"      TEXT,

  CONSTRAINT "TuitionCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TuitionCharge_studentId_level_key"
  ON "TuitionCharge"("studentId", "level");
CREATE INDEX IF NOT EXISTS "TuitionCharge_studentId_idx" ON "TuitionCharge"("studentId");
CREATE INDEX IF NOT EXISTS "TuitionCharge_tenantId_idx" ON "TuitionCharge"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TuitionCharge_studentId_fkey'
  ) THEN
    ALTER TABLE "TuitionCharge"
      ADD CONSTRAINT "TuitionCharge_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TuitionCharge_tenantId_fkey'
  ) THEN
    ALTER TABLE "TuitionCharge"
      ADD CONSTRAINT "TuitionCharge_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
