-- Honest journey-email delivery tracking (SMTP accept ≠ inbox delivery).
ALTER TABLE "JourneyEmail" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE "JourneyEmail" ADD COLUMN IF NOT EXISTS "messageId" TEXT;
ALTER TABLE "JourneyEmail" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "JourneyEmail" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "JourneyEmail_status_idx" ON "JourneyEmail"("status");
