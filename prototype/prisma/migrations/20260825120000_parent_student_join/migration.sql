-- Multi-child support for parent accounts.
--
-- `Parent.studentId` only ever held ONE child. Real families often have more
-- than one kid enrolled, so the actual link now lives here instead. This
-- table is the live source of truth for /api/parent/* and the admin linking
-- UI; `Parent.studentId` is kept for one release cycle as a rollback safety
-- net and is no longer written by new code. See the Parent/ParentStudent
-- doc-comments in prisma/schema.prisma.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry part
-- of this. Never run `prisma migrate dev` against this database.

CREATE TABLE IF NOT EXISTS "ParentStudent" (
  "id"        TEXT NOT NULL,
  "parentId"  TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "linkedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedBy"  TEXT,
  "tenantId"  TEXT,

  CONSTRAINT "ParentStudent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentStudent_parentId_studentId_key"
  ON "ParentStudent"("parentId", "studentId");
CREATE INDEX IF NOT EXISTS "ParentStudent_studentId_idx" ON "ParentStudent"("studentId");
CREATE INDEX IF NOT EXISTS "ParentStudent_tenantId_idx" ON "ParentStudent"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ParentStudent_parentId_fkey'
  ) THEN
    ALTER TABLE "ParentStudent"
      ADD CONSTRAINT "ParentStudent_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Parent"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ParentStudent_studentId_fkey'
  ) THEN
    ALTER TABLE "ParentStudent"
      ADD CONSTRAINT "ParentStudent_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ParentStudent_tenantId_fkey'
  ) THEN
    ALTER TABLE "ParentStudent"
      ADD CONSTRAINT "ParentStudent_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: every existing single-child link becomes a ParentStudent row.
-- Ids are generated in SQL (no pgcrypto/uuid extension assumed) by hashing
-- each source Parent's own id together with the current transaction clock,
-- which is unique per row and stable enough for a one-off backfill.
INSERT INTO "ParentStudent" ("id", "parentId", "studentId", "linkedAt", "tenantId")
SELECT
  'legacy_' || substr(md5("id" || clock_timestamp()::text || random()::text), 1, 20),
  "id",
  "studentId",
  "createdAt",
  "tenantId"
FROM "Parent"
WHERE "studentId" IS NOT NULL
ON CONFLICT ("parentId", "studentId") DO NOTHING;
