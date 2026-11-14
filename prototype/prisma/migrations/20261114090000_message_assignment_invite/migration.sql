-- A "assignment_invite" Message is the auto-posted card a tutor's new
-- assignment drops into the room(s) it reaches, plus the @-mention of an
-- assignment inside an ordinary chat message. See Message.assignmentId and
-- src/lib/chat-mentions.ts.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "assignmentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
