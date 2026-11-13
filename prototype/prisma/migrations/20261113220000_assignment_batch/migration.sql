-- Lets an assignment remember which intake month it is for, so students who
-- join the class after it was set (or whose batch was stored as "September 2026")
-- still see it. See Assignment.batch and src/lib/student-assignments.ts.
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "batch" TEXT;
