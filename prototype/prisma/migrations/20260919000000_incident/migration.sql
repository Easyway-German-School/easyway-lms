-- The system's memory of what went wrong: one row per distinct error/complaint/drift.
-- Additive and idempotent (see project notes: the DB may already carry this).
CREATE TABLE IF NOT EXISTS "Incident" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'open',
  "title" TEXT NOT NULL,
  "message" TEXT,
  "stack" TEXT,
  "route" TEXT,
  "method" TEXT,
  "context" JSONB,
  "samples" JSONB,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "reopenedCount" INTEGER NOT NULL DEFAULT 0,
  "tenantId" TEXT,
  "userId" TEXT,
  "feedbackId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolutionNote" TEXT,
  CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Incident_fingerprint_key" ON "Incident"("fingerprint");
CREATE INDEX IF NOT EXISTS "Incident_status_severity_lastSeenAt_idx" ON "Incident"("status", "severity", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "Incident_kind_status_lastSeenAt_idx" ON "Incident"("kind", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "Incident_route_lastSeenAt_idx" ON "Incident"("route", "lastSeenAt");
