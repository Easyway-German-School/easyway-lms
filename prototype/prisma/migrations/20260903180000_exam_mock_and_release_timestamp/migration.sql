-- Mock / pretest exam sittings, and a timestamp for when results were released.
-- `kind` distinguishes a practice paper from a real ÖSD/telc sitting; a mock
-- feeds the pre-test reminder sweep and the automatic result-release flow.
-- `resultsReleasedAt` lets the manual toggle and the auto sweep tell "released"
-- from "released just now" so a cron re-run does not re-notify a whole cohort.
--
-- Written idempotent on purpose — this project used `prisma db push` before it
-- used migrations and the column may already exist. See project-prisma-migrations.
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "resultsReleasedAt" TIMESTAMP(3);
