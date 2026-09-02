-- Admin override for the part-payment portal lock.
--
-- A student who has cleared the 60% deposit but not the tuition balance is
-- locked out of class content 30 days after their classes start
-- (PART_PAYMENT_LOCK_DAYS in src/lib/access.ts). `Student.paymentGraceUntil`
-- is the office's escape hatch: a future date here — payment plan agreed,
-- transfer in flight — suppresses the lock and the balance reminders until it
-- passes. Null means no override, which is every existing row, so there is no
-- backfill.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the column may already exist. Never
-- run `prisma migrate dev` against this database.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "paymentGraceUntil" TIMESTAMP(3);
