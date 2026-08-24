-- Additive only: one new table, two indexes, two foreign keys.
-- Generated via `prisma migrate diff --from-url <neon> --to-schema-datamodel prisma/schema.prisma --script`
-- See src/lib/daily-missions-server.ts and prisma/schema.prisma's DailyMission model.

CREATE TABLE IF NOT EXISTS "DailyMission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reward" TEXT NOT NULL,
    "detectType" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "DailyMission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyMission_tenantId_idx" ON "DailyMission"("tenantId");

CREATE INDEX IF NOT EXISTS "DailyMission_userId_day_idx" ON "DailyMission"("userId", "day");

CREATE UNIQUE INDEX IF NOT EXISTS "DailyMission_userId_day_index_key" ON "DailyMission"("userId", "day", "index");

DO $$ BEGIN
  ALTER TABLE "DailyMission" ADD CONSTRAINT "DailyMission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DailyMission" ADD CONSTRAINT "DailyMission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
