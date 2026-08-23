-- Recurring private-class series, school holidays the series engine skips,
-- and per-occurrence fields (delivery mode/location override, attendance,
-- the "this one row was edited independently of its series" flag, and the
-- proposed-new-time field a reschedule request carries).
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry part
-- of this. Never run `prisma migrate dev` against this database.

ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "deliveryMode" TEXT;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "attendanceStatus" TEXT;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "attendanceNote" TEXT;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "isException" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PrivateClass" ADD COLUMN IF NOT EXISTS "proposedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PrivateClassSeries" (
  "id"              TEXT NOT NULL,
  "studentId"       TEXT NOT NULL,
  "lecturerId"      TEXT,
  "weekdays"        JSONB NOT NULL,
  "startTime"       TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 60,
  "deliveryMode"    TEXT,
  "location"        TEXT,
  "topic"           TEXT,
  "materialId"      TEXT,
  "timezone"        TEXT NOT NULL DEFAULT 'UTC',
  "startDate"       TIMESTAMP(3) NOT NULL,
  "endDate"         TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'active',
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "tenantId"        TEXT,

  CONSTRAINT "PrivateClassSeries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrivateClassSeries_studentId_idx" ON "PrivateClassSeries"("studentId");
CREATE INDEX IF NOT EXISTS "PrivateClassSeries_tenantId_idx" ON "PrivateClassSeries"("tenantId");

CREATE TABLE IF NOT EXISTS "SchoolHoliday" (
  "id"        TEXT NOT NULL,
  "date"      TIMESTAMP(3) NOT NULL,
  "label"     TEXT NOT NULL,
  "branchId"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"  TEXT,

  CONSTRAINT "SchoolHoliday_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SchoolHoliday_date_idx" ON "SchoolHoliday"("date");
CREATE INDEX IF NOT EXISTS "SchoolHoliday_tenantId_idx" ON "SchoolHoliday"("tenantId");

-- One materialised occurrence per series per timestamp — regenerating the
-- rolling window can never double-book the same slot. NULL seriesId (every
-- one-off booking made today) is exempt: Postgres treats NULLs as distinct in
-- a unique index, so existing one-off rows are untouched by this.
CREATE UNIQUE INDEX IF NOT EXISTS "PrivateClass_seriesId_scheduledAt_key" ON "PrivateClass"("seriesId", "scheduledAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrivateClass_seriesId_fkey') THEN
    ALTER TABLE "PrivateClass"
      ADD CONSTRAINT "PrivateClass_seriesId_fkey"
      FOREIGN KEY ("seriesId") REFERENCES "PrivateClassSeries"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrivateClassSeries_studentId_fkey') THEN
    ALTER TABLE "PrivateClassSeries"
      ADD CONSTRAINT "PrivateClassSeries_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrivateClassSeries_lecturerId_fkey') THEN
    ALTER TABLE "PrivateClassSeries"
      ADD CONSTRAINT "PrivateClassSeries_lecturerId_fkey"
      FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrivateClassSeries_materialId_fkey') THEN
    ALTER TABLE "PrivateClassSeries"
      ADD CONSTRAINT "PrivateClassSeries_materialId_fkey"
      FOREIGN KEY ("materialId") REFERENCES "Material"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PrivateClassSeries_tenantId_fkey') THEN
    ALTER TABLE "PrivateClassSeries"
      ADD CONSTRAINT "PrivateClassSeries_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolHoliday_branchId_fkey') THEN
    ALTER TABLE "SchoolHoliday"
      ADD CONSTRAINT "SchoolHoliday_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SchoolHoliday_tenantId_fkey') THEN
    ALTER TABLE "SchoolHoliday"
      ADD CONSTRAINT "SchoolHoliday_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
