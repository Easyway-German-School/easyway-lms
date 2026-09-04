-- Community: voice notes, a typing indicator, and a "how a story works" coach.
--
-- Three unrelated-looking changes that ship together because they are one
-- feature pass over the class group chat:
--
--   1. Message.attachmentDurationSec — length of a voice-note attachment, so a
--      bubble can show "0:14" before the audio element has loaded a byte.
--   2. TypingPing — a disposable "someone is typing here now" row, one per
--      (channel, member), re-stamped every few seconds and treated as live for
--      a few seconds past updatedAt. Swept opportunistically; no cron.
--   3. Student.storyTourSeenAt — when the student finished/skipped the separate
--      Becca walk-through of the take-turns story game.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- 1. Voice-note length
-- ---------------------------------------------------------------------------

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachmentDurationSec" INTEGER;

-- ---------------------------------------------------------------------------
-- 2. Student.storyTourSeenAt
-- ---------------------------------------------------------------------------

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "storyTourSeenAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 3. TypingPing — one live "is typing" marker per (channel, member)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "TypingPing" (
  "id"        TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"  TEXT,

  CONSTRAINT "TypingPing_pkey" PRIMARY KEY ("id")
);

-- The upsert key: at most one row per person per room.
CREATE UNIQUE INDEX IF NOT EXISTS "TypingPing_channelId_userId_key"
  ON "TypingPing" ("channelId", "userId");

-- "Who is typing in this room, updated since a few seconds ago" — and the same
-- index answers the opportunistic sweep of stale rows.
CREATE INDEX IF NOT EXISTS "TypingPing_channelId_updatedAt_idx"
  ON "TypingPing" ("channelId", "updatedAt");

CREATE INDEX IF NOT EXISTS "TypingPing_userId_idx"
  ON "TypingPing" ("userId");

CREATE INDEX IF NOT EXISTS "TypingPing_tenantId_idx"
  ON "TypingPing" ("tenantId");

-- Cascades: a deleted channel, user or tenant takes its typing rows with it.
-- Guarded because the constraints may already exist from an earlier `db push`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TypingPing_channelId_fkey') THEN
    ALTER TABLE "TypingPing"
      ADD CONSTRAINT "TypingPing_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TypingPing_userId_fkey') THEN
    ALTER TABLE "TypingPing"
      ADD CONSTRAINT "TypingPing_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TypingPing_tenantId_fkey') THEN
    ALTER TABLE "TypingPing"
      ADD CONSTRAINT "TypingPing_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
