-- Richer learner events: what, where, on whose clock, in which sitting.
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "path" TEXT;
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "detail" TEXT;
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "deviceKind" TEXT;
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "hourLocal" INTEGER;
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "weekday" INTEGER;
ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "sessionKey" TEXT;

CREATE INDEX IF NOT EXISTS "LearnerUsageEvent_tenantId_occurredAt_idx" ON "LearnerUsageEvent"("tenantId", "occurredAt");
CREATE INDEX IF NOT EXISTS "LearnerUsageEvent_sessionKey_idx" ON "LearnerUsageEvent"("sessionKey");

-- An explicit refusal, as opposed to "never opted in to the beta programme".
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "analyticsOptOutAt" TIMESTAMP(3);

-- The cached reading of a learner's behaviour. Every column is derived; the
-- table can be truncated and rebuilt from LearnerUsageEvent at any time.
CREATE TABLE IF NOT EXISTS "LearnerBehaviourProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT,
  "archetype" TEXT NOT NULL DEFAULT 'newcomer',
  "peakHour" INTEGER,
  "peakWeekday" INTEGER,
  "sessionsPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgSessionMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "predictability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "daysSinceSeen" INTEGER,
  "totalEvents" INTEGER NOT NULL DEFAULT 0,
  "activeDays" INTEGER NOT NULL DEFAULT 0,
  "signals" JSONB,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearnerBehaviourProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearnerBehaviourProfile_userId_key" ON "LearnerBehaviourProfile"("userId");
CREATE INDEX IF NOT EXISTS "LearnerBehaviourProfile_tenantId_riskScore_idx" ON "LearnerBehaviourProfile"("tenantId", "riskScore");
CREATE INDEX IF NOT EXISTS "LearnerBehaviourProfile_tenantId_archetype_idx" ON "LearnerBehaviourProfile"("tenantId", "archetype");
CREATE INDEX IF NOT EXISTS "LearnerBehaviourProfile_tenantId_engagementScore_idx" ON "LearnerBehaviourProfile"("tenantId", "engagementScore");

DO $$ BEGIN
  ALTER TABLE "LearnerBehaviourProfile"
    ADD CONSTRAINT "LearnerBehaviourProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LearnerBehaviourProfile"
    ADD CONSTRAINT "LearnerBehaviourProfile_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
