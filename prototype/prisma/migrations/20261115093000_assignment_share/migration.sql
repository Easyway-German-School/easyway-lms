-- Repost-an-assignment-to-community: Message.sharedAssignmentId + Message.mentionedUserId.
-- Idempotent — see prototype/prisma/manual/ and project-prisma-migrations memory.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "sharedAssignmentId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mentionedUserId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_sharedAssignmentId_fkey"
    FOREIGN KEY ("sharedAssignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_mentionedUserId_fkey"
    FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
