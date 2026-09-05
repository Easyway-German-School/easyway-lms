-- The SMS send queue — mirrors EmailMessage. See src/lib/sms-queue.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

-- CreateTable
CREATE TABLE IF NOT EXISTS "SmsMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "studentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SmsMessage_status_scheduledFor_idx" ON "SmsMessage" ("status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "SmsMessage_studentId_idx" ON "SmsMessage" ("studentId");
CREATE INDEX IF NOT EXISTS "SmsMessage_tenantId_idx" ON "SmsMessage" ("tenantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
