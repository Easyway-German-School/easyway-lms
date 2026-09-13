-- The self-service ÖSD exam-booking flow: document collection (passport
-- photo + passport data page) and a manual bank-transfer payment rail
-- alongside the existing Paystack one. See src/lib/exam-documents.ts and
-- verifyBankTransfer() in src/lib/exam-payments.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "transferProofUrl" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "transferReference" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "transferVerifiedBy" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "transferVerifiedAt" TIMESTAMP(3);
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "transferRejectedReason" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "passportPhotoUrl" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "passportDataPageUrl" TEXT;
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "documentStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "ExamRegistration" ADD COLUMN IF NOT EXISTS "documentRejectedReason" TEXT;
