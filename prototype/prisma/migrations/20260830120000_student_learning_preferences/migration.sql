-- The cold-start seed for the personalised study plan.
--
-- `Student.learningPreferences` holds what a learner said about how they like
-- to learn before the portal had any behaviour to read — `{ format, pace,
-- setAt }`. src/lib/learner-style.ts uses it as a gentle prior that real
-- behaviour overrules within a fortnight. Nullable, no backfill: a student who
-- never answers the one-question card simply has no seed and is ranked on
-- academics + observed behaviour alone.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the column may already exist. Never
-- run `prisma migrate dev` against this database.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "learningPreferences" JSONB;
