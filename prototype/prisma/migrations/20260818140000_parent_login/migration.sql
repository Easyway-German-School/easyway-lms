-- A parent/guardian's own account, and the child it claims.
--
-- Just the account and the claimed link for now — not the monitoring screens
-- (attendance, results, notifications) that will read from it later. See the
-- Parent model doc-comment in prisma/schema.prisma.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry part
-- of this. Never run `prisma migrate dev` against this database.

-- New enum value. Safe inside a transaction on modern Postgres as long as
-- nothing in this same transaction reads it back, which nothing here does.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARENT';

CREATE TABLE IF NOT EXISTS "Parent" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "phone"            TEXT,
  "studentId"        TEXT,
  "childName"        TEXT,
  "childEmail"       TEXT,
  "childStudentCode" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"         TEXT,

  CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Parent_userId_key" ON "Parent"("userId");
CREATE INDEX IF NOT EXISTS "Parent_studentId_idx" ON "Parent"("studentId");
CREATE INDEX IF NOT EXISTS "Parent_tenantId_idx" ON "Parent"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Parent_userId_fkey'
  ) THEN
    ALTER TABLE "Parent"
      ADD CONSTRAINT "Parent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Parent_studentId_fkey'
  ) THEN
    ALTER TABLE "Parent"
      ADD CONSTRAINT "Parent_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Parent_tenantId_fkey'
  ) THEN
    ALTER TABLE "Parent"
      ADD CONSTRAINT "Parent_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
