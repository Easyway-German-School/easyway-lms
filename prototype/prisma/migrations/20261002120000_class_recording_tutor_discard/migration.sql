-- When set, the tutor who taught this class chose (in the end-of-class
-- prompt shown for a short recording) to delete it outright rather than let
-- it go through the normal hold-and-48h-grace review. See the field comment
-- on ClassRecording.tutorDiscardRequestedAt in schema.prisma.
-- Additive and idempotent.
ALTER TABLE "ClassRecording" ADD COLUMN IF NOT EXISTS "tutorDiscardRequestedAt" TIMESTAMP(3);
