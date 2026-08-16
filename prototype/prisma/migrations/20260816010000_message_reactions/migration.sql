-- Emoji reactions on chat messages.
--
-- One new table and nothing else. No column is added to an existing table, no
-- index is dropped, no data is touched, and nothing currently deployed reads
-- it — so applying it early breaks nothing and applying it late loses nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- MessageReaction — one person's one reaction to one message
-- ---------------------------------------------------------------------------
--
-- A row per person per emoji rather than a counter on Message. The question
-- the UI asks is "did I react, and with what" — that decides whether a tap
-- adds or removes — and a bare count cannot answer it.
--
-- The unique index is load-bearing rather than tidy: it is what makes the
-- toggle safe to double-tap. Without it an impatient tap on a slow phone
-- inflates the count and there is no way to tell the duplicate from a real
-- second reader.

CREATE TABLE IF NOT EXISTS "MessageReaction" (
  "id"        TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "emoji"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"  TEXT,

  CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_userId_emoji_key"
  ON "MessageReaction" ("messageId", "userId", "emoji");

-- The only read that matters: every reaction on the page of messages being
-- rendered.
CREATE INDEX IF NOT EXISTS "MessageReaction_messageId_idx"
  ON "MessageReaction" ("messageId");

CREATE INDEX IF NOT EXISTS "MessageReaction_tenantId_idx"
  ON "MessageReaction" ("tenantId");

-- Cascades: a deleted message takes its reactions, and so does a deleted user.
-- Guarded because the constraints may already exist from an earlier `db push`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_messageId_fkey') THEN
    ALTER TABLE "MessageReaction"
      ADD CONSTRAINT "MessageReaction_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "Message"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_userId_fkey') THEN
    ALTER TABLE "MessageReaction"
      ADD CONSTRAINT "MessageReaction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageReaction_tenantId_fkey') THEN
    ALTER TABLE "MessageReaction"
      ADD CONSTRAINT "MessageReaction_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
