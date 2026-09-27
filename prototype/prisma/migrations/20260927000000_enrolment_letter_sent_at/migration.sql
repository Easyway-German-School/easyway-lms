-- The automatic proof-of-enrolment letter (see lib/enrolment-letter-trigger.ts)
-- fires once, when tuition first clears in full, not at registration. This is
-- the claim flag that makes it a once-only send even though several payment
-- paths (Paystack webhook, Paystack verify, Stripe webhook, a hand-entered
-- admin payment) can all observe the crossing for the same student.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "enrolmentLetterSentAt" TIMESTAMP(3);
