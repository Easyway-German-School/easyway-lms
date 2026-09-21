-- "Somebody is typing in this enquiry" — one disposable row per (ticket, person).
-- Twin of TypingPing (community channels). Additive and idempotent.
CREATE TABLE IF NOT EXISTS "SupportTypingPing" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "SupportTypingPing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTypingPing_ticketId_userId_key" ON "SupportTypingPing"("ticketId", "userId");
CREATE INDEX IF NOT EXISTS "SupportTypingPing_ticketId_updatedAt_idx" ON "SupportTypingPing"("ticketId", "updatedAt");
CREATE INDEX IF NOT EXISTS "SupportTypingPing_userId_idx" ON "SupportTypingPing"("userId");
CREATE INDEX IF NOT EXISTS "SupportTypingPing_tenantId_idx" ON "SupportTypingPing"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTypingPing_ticketId_fkey') THEN
    ALTER TABLE "SupportTypingPing" ADD CONSTRAINT "SupportTypingPing_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTypingPing_userId_fkey') THEN
    ALTER TABLE "SupportTypingPing" ADD CONSTRAINT "SupportTypingPing_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportTypingPing_tenantId_fkey') THEN
    ALTER TABLE "SupportTypingPing" ADD CONSTRAINT "SupportTypingPing_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
