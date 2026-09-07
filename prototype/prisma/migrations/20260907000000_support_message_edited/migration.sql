-- The office can now correct or take back a support-ticket message it already
-- sent (see src/lib/support.ts editMessage / deleteMessage). A delete is a real
-- DELETE — an enquiry reply sent by mistake should leave nothing behind — so
-- the only schema change is a marker for the edit case.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- `migrate deploy` runs on every Vercel build; the column may already exist
-- from an earlier `db push`.

-- AlterTable
ALTER TABLE "SupportTicketMessage" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
