-- Screenshots on the help desk. Both sides — the student and the office — can
-- now attach images to a support-ticket message (an error on screen, a payment
-- receipt), so "this isn't working" can carry a picture of what isn't working
-- instead of that conversation moving to WhatsApp. See src/lib/support.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- `migrate deploy` runs on every Vercel build; the column may already exist
-- from an earlier `db push`.

-- AlterTable
ALTER TABLE "SupportTicketMessage" ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]';
