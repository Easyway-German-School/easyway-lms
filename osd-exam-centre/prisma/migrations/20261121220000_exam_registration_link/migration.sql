-- The official ÖSD/Panthexa registration link ÖSD hands Easyway once a sitting
-- is confirmed, plus its deadline and when we actually emailed it to the
-- candidate. Written idempotent so a partial re-run is harmless.

ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "examRegistrationLink" TEXT;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "examRegistrationDeadline" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "registrationLinkSentAt" TIMESTAMP(3);
