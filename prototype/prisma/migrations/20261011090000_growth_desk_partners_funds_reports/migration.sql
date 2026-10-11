-- Growth Desk, second slice: Partner (corporate/partnership CRM),
-- FundRequest (BDM spend approval), DailyReport (teamlead daily log).

CREATE TABLE IF NOT EXISTS "Partner" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "type" TEXT NOT NULL DEFAULT 'partner',
  "status" TEXT NOT NULL DEFAULT 'prospecting',
  "ownerId" TEXT,
  "notes" TEXT,
  "lastContactedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FundRequest" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "FundRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DailyReport" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "achievement" TEXT NOT NULL,
  "problemSolved" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Partner_ownerId_status_idx" ON "Partner"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Partner_tenantId_idx" ON "Partner"("tenantId");

CREATE INDEX IF NOT EXISTS "FundRequest_requesterId_status_idx" ON "FundRequest"("requesterId", "status");
CREATE INDEX IF NOT EXISTS "FundRequest_tenantId_idx" ON "FundRequest"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "DailyReport_authorId_reportDate_key" ON "DailyReport"("authorId", "reportDate");
CREATE INDEX IF NOT EXISTS "DailyReport_tenantId_idx" ON "DailyReport"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Partner_ownerId_fkey' AND conrelid = '"Partner"'::regclass
  ) THEN
    ALTER TABLE "Partner"
    ADD CONSTRAINT "Partner_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Partner_tenantId_fkey' AND conrelid = '"Partner"'::regclass
  ) THEN
    ALTER TABLE "Partner"
    ADD CONSTRAINT "Partner_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FundRequest_requesterId_fkey' AND conrelid = '"FundRequest"'::regclass
  ) THEN
    ALTER TABLE "FundRequest"
    ADD CONSTRAINT "FundRequest_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FundRequest_approvedById_fkey' AND conrelid = '"FundRequest"'::regclass
  ) THEN
    ALTER TABLE "FundRequest"
    ADD CONSTRAINT "FundRequest_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FundRequest_tenantId_fkey' AND conrelid = '"FundRequest"'::regclass
  ) THEN
    ALTER TABLE "FundRequest"
    ADD CONSTRAINT "FundRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'DailyReport_authorId_fkey' AND conrelid = '"DailyReport"'::regclass
  ) THEN
    ALTER TABLE "DailyReport"
    ADD CONSTRAINT "DailyReport_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'DailyReport_tenantId_fkey' AND conrelid = '"DailyReport"'::regclass
  ) THEN
    ALTER TABLE "DailyReport"
    ADD CONSTRAINT "DailyReport_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
