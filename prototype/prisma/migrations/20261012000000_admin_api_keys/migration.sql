-- Admin-issued API keys: a self-serve credential for calling /api/admin/*
-- without a browser session. Mirrors the shape of ApiKey (the partner-facing
-- table) but borrows a real admin's own identity/tenant rather than acting as
-- a scoped third party. See AdminApiKey in schema.prisma and requireCapability
-- in src/lib/admin-roles.ts.
--
-- The AdminApiKey model itself already landed in schema.prisma via the
-- auto_heal migration (20261011190000) — it was swept into that commit from
-- this feature's own in-progress schema change in a shared working tree —
-- but that migration only creates AutoHealPattern/AutoHealLog. This fills the
-- gap: the model has existed with no backing table until now.

CREATE TABLE IF NOT EXISTS "AdminApiKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "capabilities" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminApiKey_prefix_key" ON "AdminApiKey"("prefix");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminApiKey_tokenHash_key" ON "AdminApiKey"("tokenHash");
CREATE INDEX IF NOT EXISTS "AdminApiKey_userId_idx" ON "AdminApiKey"("userId");
CREATE INDEX IF NOT EXISTS "AdminApiKey_tenantId_idx" ON "AdminApiKey"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminApiKey_userId_fkey' AND conrelid = '"AdminApiKey"'::regclass) THEN
    ALTER TABLE "AdminApiKey" ADD CONSTRAINT "AdminApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminApiKey_tenantId_fkey' AND conrelid = '"AdminApiKey"'::regclass) THEN
    ALTER TABLE "AdminApiKey" ADD CONSTRAINT "AdminApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
