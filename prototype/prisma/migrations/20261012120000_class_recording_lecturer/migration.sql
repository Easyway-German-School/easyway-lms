-- Denormalise the tutor onto ClassRecording, same spirit as branchId/level/sessionSlot
-- above it. Lets a student named onto this tutor (Student.tutorId / co-tutors) see the
-- recording even when their own branch/level/sitting never lined up with the room the
-- class ran in — see class-recorder.ts and app/api/student/videos/route.ts.

ALTER TABLE "ClassRecording"
ADD COLUMN IF NOT EXISTS "lecturerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassRecording_lecturerId_fkey' AND conrelid = '"ClassRecording"'::regclass) THEN
    ALTER TABLE "ClassRecording" ADD CONSTRAINT "ClassRecording_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ClassRecording_lecturerId_idx" ON "ClassRecording"("lecturerId");
