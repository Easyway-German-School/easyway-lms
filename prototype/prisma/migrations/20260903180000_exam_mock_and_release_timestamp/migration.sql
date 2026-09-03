-- Mock / pretest exam sittings, and a timestamp for when results were released.
-- `kind` distinguishes a practice paper from a real ÖSD/telc sitting; a mock
-- feeds the pre-test reminder sweep and the automatic result-release flow.
-- `resultsReleasedAt` lets the manual toggle and the auto sweep tell "released"
-- from "released just now" so a cron re-run does not re-notify a whole cohort.
ALTER TABLE "Exam" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN     "resultsReleasedAt" TIMESTAMP(3);
