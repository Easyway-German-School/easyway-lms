-- Two unrelated additive fields, bundled because they shipped together:
-- 1. displaySeatsRemaining — an optional cosmetic override for the public
--    "seats left" count, independent of the real capacity/booking count
--    that still drives seat numbering and overselling protection.
-- 2. secondaryIdType — the second ID document a candidate must also bring
--    on exam day, alongside the existing idType/idNumber/idExpiry.
-- Written idempotent so a partial re-run is harmless.

ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "displaySeatsRemaining" INTEGER;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "secondaryIdType" TEXT;
