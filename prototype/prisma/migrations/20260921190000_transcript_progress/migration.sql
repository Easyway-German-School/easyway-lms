-- How far into a recording the transcription has got, so it can be done a few minutes at a time.
-- Additive and idempotent.
ALTER TABLE "ClassTranscript" ADD COLUMN IF NOT EXISTS "transcribedUntil" DOUBLE PRECISION;
