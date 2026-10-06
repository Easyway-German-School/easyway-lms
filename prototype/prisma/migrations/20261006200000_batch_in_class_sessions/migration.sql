-- A batch's calendar is its own.
--
-- ClassSession (one row per class-day override: topic, postponed, cancelled,
-- material) was unique on branch + level + date + sitting. September and
-- October of the same sitting overlap for a month, and the weekend sitting meets
-- the same Saturdays for both, so a postponement saved for one batch landed on
-- the other's calendar too.
--
-- Same move as 20261006090000_batch_in_live_and_community: widen the unique key
-- by the batch. Existing rows keep batch = '' ("every batch"), so every class
-- already scheduled, moved or cancelled looks exactly as it did; the app writes
-- a batch's own row the first time that day is edited for it.
--
-- Written by hand and idempotent, per prisma/manual/README.

ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "batch" TEXT NOT NULL DEFAULT '';

-- The old key would reject a second batch's row for the same day.
DROP INDEX IF EXISTS "ClassSession_branchId_level_date_timeSlot_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_branchId_level_date_timeSlot_batch_key"
  ON "ClassSession" ("branchId", "level", "date", "timeSlot", "batch");
