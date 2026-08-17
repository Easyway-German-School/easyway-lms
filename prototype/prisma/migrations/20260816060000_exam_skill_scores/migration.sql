-- Per-skill exam scoring: internal EASYWAY exams follow the same four-skill
-- structure as the real ÖSD/Goethe exams they prepare students for — Lesen,
-- Hören, Schreiben, Sprechen — instead of one opaque total. `Grade.score`
-- keeps meaning "the overall result" (computed as the minimum of the four
-- skills once they're entered, since a real sitting is skill-gated, not
-- averaged), and the four new columns are only populated for that case.
--
-- `Exam.passThreshold` is the per-skill minimum to pass, set per sitting
-- rather than hardcoded, defaulting to the conventional 60/100.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "readingScore" INTEGER;
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "listeningScore" INTEGER;
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "writingScore" INTEGER;
ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "speakingScore" INTEGER;

ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "passThreshold" INTEGER NOT NULL DEFAULT 60;
