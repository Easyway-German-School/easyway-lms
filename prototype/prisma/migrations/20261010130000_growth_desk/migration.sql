-- Growth Desk: the sales pipeline sitting on top of Lead.
-- See the schema comment above `model LeadActivity` in schema.prisma for why
-- this is three separate tables rather than fields bolted onto Lead.

ALTER TABLE "Lead"
ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_assignedToId_status_idx"
ON "Lead"("assignedToId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Lead_assignedToId_fkey'
      AND conrelid = '"Lead"'::regclass
  ) THEN
    ALTER TABLE "Lead"
    ADD CONSTRAINT "Lead_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LeadActivity" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SalesTask" (
  "id" TEXT NOT NULL,
  "assignedToId" TEXT NOT NULL,
  "leadId" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "autoAssigned" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "SalesTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommissionEntry" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "repId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "rateApplied" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "LeadActivity_tenantId_idx" ON "LeadActivity"("tenantId");

CREATE INDEX IF NOT EXISTS "SalesTask_assignedToId_status_priorityScore_idx"
ON "SalesTask"("assignedToId", "status", "priorityScore");
CREATE INDEX IF NOT EXISTS "SalesTask_leadId_idx" ON "SalesTask"("leadId");
CREATE INDEX IF NOT EXISTS "SalesTask_tenantId_idx" ON "SalesTask"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionEntry_paymentId_key" ON "CommissionEntry"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionEntry_repId_status_idx" ON "CommissionEntry"("repId", "status");
CREATE INDEX IF NOT EXISTS "CommissionEntry_tenantId_idx" ON "CommissionEntry"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LeadActivity_leadId_fkey' AND conrelid = '"LeadActivity"'::regclass
  ) THEN
    ALTER TABLE "LeadActivity"
    ADD CONSTRAINT "LeadActivity_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LeadActivity_actorId_fkey' AND conrelid = '"LeadActivity"'::regclass
  ) THEN
    ALTER TABLE "LeadActivity"
    ADD CONSTRAINT "LeadActivity_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LeadActivity_tenantId_fkey' AND conrelid = '"LeadActivity"'::regclass
  ) THEN
    ALTER TABLE "LeadActivity"
    ADD CONSTRAINT "LeadActivity_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesTask_assignedToId_fkey' AND conrelid = '"SalesTask"'::regclass
  ) THEN
    ALTER TABLE "SalesTask"
    ADD CONSTRAINT "SalesTask_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesTask_leadId_fkey' AND conrelid = '"SalesTask"'::regclass
  ) THEN
    ALTER TABLE "SalesTask"
    ADD CONSTRAINT "SalesTask_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SalesTask_tenantId_fkey' AND conrelid = '"SalesTask"'::regclass
  ) THEN
    ALTER TABLE "SalesTask"
    ADD CONSTRAINT "SalesTask_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommissionEntry_leadId_fkey' AND conrelid = '"CommissionEntry"'::regclass
  ) THEN
    ALTER TABLE "CommissionEntry"
    ADD CONSTRAINT "CommissionEntry_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommissionEntry_repId_fkey' AND conrelid = '"CommissionEntry"'::regclass
  ) THEN
    ALTER TABLE "CommissionEntry"
    ADD CONSTRAINT "CommissionEntry_repId_fkey"
    FOREIGN KEY ("repId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommissionEntry_paymentId_fkey' AND conrelid = '"CommissionEntry"'::regclass
  ) THEN
    ALTER TABLE "CommissionEntry"
    ADD CONSTRAINT "CommissionEntry_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommissionEntry_approvedById_fkey' AND conrelid = '"CommissionEntry"'::regclass
  ) THEN
    ALTER TABLE "CommissionEntry"
    ADD CONSTRAINT "CommissionEntry_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommissionEntry_tenantId_fkey' AND conrelid = '"CommissionEntry"'::regclass
  ) THEN
    ALTER TABLE "CommissionEntry"
    ADD CONSTRAINT "CommissionEntry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
