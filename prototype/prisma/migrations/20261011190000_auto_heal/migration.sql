-- The one fully-automatic repair in Mission Control, and its kill switch.
-- See AutoHealPattern / AutoHealLog in schema.prisma and src/lib/auto-heal.ts
-- for what it does and why it is safe to run without a human click.

CREATE TABLE IF NOT EXISTS "AutoHealPattern" (
  "key"         TEXT NOT NULL,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "dryRun"      BOOLEAN NOT NULL DEFAULT true,
  "maxPerHour"  INTEGER NOT NULL DEFAULT 30,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "AutoHealPattern_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "AutoHealLog" (
  "id"        TEXT NOT NULL,
  "pattern"   TEXT NOT NULL,
  "action"    TEXT NOT NULL,
  "studentId" TEXT,
  "tenantId"  TEXT,
  "detail"    JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutoHealLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutoHealLog_pattern_createdAt_idx" ON "AutoHealLog"("pattern", "createdAt");
CREATE INDEX IF NOT EXISTS "AutoHealLog_pattern_studentId_action_createdAt_idx" ON "AutoHealLog"("pattern", "studentId", "action", "createdAt");

-- Seed the one pattern this ships with: enabled, but dry-run until a human
-- flips it off from the Patterns tab. Never overwrite a row that already
-- exists — an admin's own toggle choice must survive a redeploy.
INSERT INTO "AutoHealPattern" ("key", "enabled", "dryRun", "maxPerHour", "updatedAt")
VALUES ('portal-witness-resync', true, true, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
