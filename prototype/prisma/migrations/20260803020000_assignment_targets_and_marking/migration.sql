-- Online tests: named recipients, and a marking queue for written answers.
--
-- Additive only. Every existing assignment has no targets, which the query
-- layer reads as "everyone at this level and branch" — exactly what those
-- assignments did before this migration. No backfill, no rewrite, no lock
-- worth naming; safe to run against the live database during the day.

-- Named recipients. Empty for an assignment means it goes to the whole level.
CREATE TABLE IF NOT EXISTS "AssignmentTarget" (
    "id"           TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId"    TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentTarget_pkey" PRIMARY KEY ("id")
);

-- One row per student per assignment: setting the same test twice for the
-- same person is a mistake, not a second attempt.
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentTarget_assignmentId_studentId_key"
    ON "AssignmentTarget"("assignmentId", "studentId");

-- The hot read is "what has this student been set?", so it gets its own index.
CREATE INDEX IF NOT EXISTS "AssignmentTarget_studentId_idx"
    ON "AssignmentTarget"("studentId");

DO $$
BEGIN
    ALTER TABLE "AssignmentTarget"
        ADD CONSTRAINT "AssignmentTarget_assignmentId_fkey"
        FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "AssignmentTarget"
        ADD CONSTRAINT "AssignmentTarget_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "Student"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Per-question marks, kept so a student sees which questions cost them the
-- marks, and so a disputed result can be re-read long after the fact.
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "questionScores" JSONB;

-- Set while a written answer is waiting for a tutor. `score` stays NULL
-- throughout, so a part-marked paper never shows a misleading percentage.
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "markedById" TEXT;
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "markedAt" TIMESTAMP(3);
