-- Campus (slice 1): presence, requests, Wortduell duels, coin ledger.
-- Hand-written and idempotent, like every migration here: the database may
-- already carry the change from a db push.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "coinBalance" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "CampusPresence" (
  "userId"     TEXT NOT NULL,
  "tenantId"   TEXT,
  "band"       TEXT NOT NULL,
  "room"       TEXT NOT NULL DEFAULT 'lobby',
  "hidden"     BOOLEAN NOT NULL DEFAULT false,
  "eligible"   BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampusPresence_pkey" PRIMARY KEY ("userId")
);
CREATE INDEX IF NOT EXISTS "CampusPresence_tenantId_band_lastSeenAt_idx"
  ON "CampusPresence" ("tenantId", "band", "lastSeenAt");

CREATE TABLE IF NOT EXISTS "CampusRequest" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT,
  "band"       TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId"   TEXT,
  "status"     TEXT NOT NULL DEFAULT 'open',
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "duelId"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampusRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CampusRequest_toUserId_status_expiresAt_idx"
  ON "CampusRequest" ("toUserId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "CampusRequest_tenantId_band_kind_status_expiresAt_idx"
  ON "CampusRequest" ("tenantId", "band", "kind", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "CampusRequest_fromUserId_createdAt_idx"
  ON "CampusRequest" ("fromUserId", "createdAt");

CREATE TABLE IF NOT EXISTS "CampusDuel" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT,
  "band"       TEXT NOT NULL,
  "level"      TEXT NOT NULL,
  "playerAId"  TEXT NOT NULL,
  "playerBId"  TEXT NOT NULL,
  "questions"  JSONB NOT NULL,
  "answersA"   JSONB,
  "answersB"   JSONB,
  "status"     TEXT NOT NULL DEFAULT 'active',
  "winnerId"   TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "CampusDuel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CampusDuel_playerAId_createdAt_idx" ON "CampusDuel" ("playerAId", "createdAt");
CREATE INDEX IF NOT EXISTS "CampusDuel_playerBId_createdAt_idx" ON "CampusDuel" ("playerBId", "createdAt");
CREATE INDEX IF NOT EXISTS "CampusDuel_tenantId_status_createdAt_idx" ON "CampusDuel" ("tenantId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "CoinTransaction" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT,
  "studentId" TEXT NOT NULL,
  "amount"    INTEGER NOT NULL,
  "reason"    TEXT NOT NULL,
  "refKey"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CoinTransaction_studentId_refKey_key" ON "CoinTransaction" ("studentId", "refKey");
CREATE INDEX IF NOT EXISTS "CoinTransaction_studentId_createdAt_idx" ON "CoinTransaction" ("studentId", "createdAt");
CREATE INDEX IF NOT EXISTS "CoinTransaction_tenantId_createdAt_idx" ON "CoinTransaction" ("tenantId", "createdAt");
