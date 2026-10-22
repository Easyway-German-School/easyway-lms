-- Lets a student resubmit a handed-in assignment once (wrong file, caught a
-- mistake) before it is marked. See AssignmentSubmission.editCount.
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "editCount" INTEGER NOT NULL DEFAULT 0;
