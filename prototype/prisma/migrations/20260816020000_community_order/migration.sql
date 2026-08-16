-- Pinned messages, and muting a student who will not settle.
--
-- Two additive changes: two nullable columns on Message, and one new table.
-- No existing column changes type, no index is dropped, no data is touched.
-- Nothing currently deployed reads either, so applying early breaks nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- Message.pinnedAt / pinnedById — staff holding something at the top
-- ---------------------------------------------------------------------------
--
-- A pin is the opposite of the moderation already on this table. Removal takes
-- a message away; a pin is how "the exam is on the 14th" stops being buried
-- under two hundred lines of chat by Tuesday.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinnedAt"   TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinnedById" TEXT;

-- Finding the handful of pinned messages in a room without scanning it.
CREATE INDEX IF NOT EXISTS "Message_channelId_pinnedAt_idx"
  ON "Message" ("channelId", "pinnedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_pinnedById_fkey') THEN
    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_pinnedById_fkey"
      FOREIGN KEY ("pinnedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CommunityMute — stopped from posting, until a moment in time
-- ---------------------------------------------------------------------------
--
-- A mute, not a ban. The student keeps reading: they stay in their class group
-- and still get the announcements and the homework, they just cannot post.
-- Removing them from the room would cut them off from their class over a
-- behaviour problem, which is a heavier punishment than the school intends.
--
-- "mutedUntil" is NOT NULL on purpose. There is no indefinite mute, because a
-- mute nobody remembers to lift is a permanent silent exclusion — and the
-- person who set it is rarely the person on duty when it should end.
--
-- One row per user (UNIQUE), so re-muting somebody updates the end time rather
-- than stacking overlapping mutes nobody can reason about.

CREATE TABLE IF NOT EXISTS "CommunityMute" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "mutedUntil" TIMESTAMP(3) NOT NULL,
  "reason"     TEXT,
  "mutedById"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"   TEXT,

  CONSTRAINT "CommunityMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityMute_userId_key"
  ON "CommunityMute" ("userId");

CREATE INDEX IF NOT EXISTS "CommunityMute_tenantId_idx"
  ON "CommunityMute" ("tenantId");

-- Sweeping lapsed mutes.
CREATE INDEX IF NOT EXISTS "CommunityMute_mutedUntil_idx"
  ON "CommunityMute" ("mutedUntil");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMute_userId_fkey') THEN
    ALTER TABLE "CommunityMute"
      ADD CONSTRAINT "CommunityMute_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMute_mutedById_fkey') THEN
    ALTER TABLE "CommunityMute"
      ADD CONSTRAINT "CommunityMute_mutedById_fkey"
      FOREIGN KEY ("mutedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMute_tenantId_fkey') THEN
    ALTER TABLE "CommunityMute"
      ADD CONSTRAINT "CommunityMute_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
