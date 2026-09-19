-- One row per student: why their portal is open/locked, and what their screen last showed.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "AccessSnapshot" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "tenantId" TEXT,
  "open" BOOLEAN NOT NULL,
  "verdictKey" TEXT NOT NULL,
  "locks" JSONB NOT NULL,
  "inputs" JSONB,
  "changedAt" TIMESTAMP(3) NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "lastWitnessAt" TIMESTAMP(3),
  "lastWitnessRendered" TEXT,
  "lastWitnessPath" TEXT,
  CONSTRAINT "AccessSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccessSnapshot_studentId_key" ON "AccessSnapshot"("studentId");
CREATE INDEX IF NOT EXISTS "AccessSnapshot_open_changedAt_idx" ON "AccessSnapshot"("open", "changedAt");
CREATE INDEX IF NOT EXISTS "AccessSnapshot_tenantId_idx" ON "AccessSnapshot"("tenantId");
