-- The BATCH is part of a class room: live classroom and community chat.
--
-- Until now both were keyed on branch + level + sitting. The September A1
-- morning group and the October A1 morning group overlap for a month (October
-- starts while September is mid-course), so they shared one video room, got one
-- another's "class is live" push, and chatted in one community room.
--
-- Written by hand and idempotent, per prisma/manual/README. Same shape as
-- 20260812000000_session_slot_spaces_and_group_chat, which did this for the
-- sitting: widen the unique key by one column. Existing rows keep batch = ''
-- (Space) / NULL (LiveClassSession), i.e. today's behaviour; the app moves a
-- cohort's existing chat onto its longest-running batch the first time a batch
-- room is asked for (see ensureSpaceForCohort).

-- 1. Live classes remember which batch they were for.
ALTER TABLE "LiveClassSession" ADD COLUMN IF NOT EXISTS "batch" TEXT;

-- 2. Community rooms gain the batch. '' = the students with no batch.
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "batch" TEXT NOT NULL DEFAULT '';

-- The old key would reject a second batch of the same sitting.
DROP INDEX IF EXISTS "Space_branchId_level_sessionSlot_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Space_branchId_level_sessionSlot_batch_key"
  ON "Space" ("branchId", "level", "sessionSlot", "batch");
