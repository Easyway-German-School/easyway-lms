-- Stores the tutor's actual private online exam-preparation offerings.
-- Nullable keeps existing tutor records valid until the office classifies them.
ALTER TABLE "Lecturer" ADD COLUMN IF NOT EXISTS "classifications" JSONB;