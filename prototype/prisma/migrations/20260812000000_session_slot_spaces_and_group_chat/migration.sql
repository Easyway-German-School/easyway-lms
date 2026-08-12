-- Session-scoped community spaces, and the group chat that replaced the forum.
--
-- Two changes that have to land together, because the second one is what makes
-- the first one worth doing.
--
-- 1. A Space is now keyed on (branch, level, sessionSlot) instead of
--    (branch, level). Branch + level was never a class: Lagos runs A1 in the
--    morning, the afternoon and the evening as three separate cohorts with
--    three different tutors, and they were all sharing one room.
--
-- 2. Thread + Comment become Message. A forum asks you to pick a title and a
--    place before it lets you speak; a chat does not. The old data is carried
--    across rather than dropped — a thread becomes its opening message and its
--    comments become replies quoting it — so nothing anybody wrote is lost.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of this.

-- ---------------------------------------------------------------------------
-- 1. Space gains its sitting
-- ---------------------------------------------------------------------------

ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "sessionSlot" TEXT NOT NULL DEFAULT 'morning';

-- The old unique key would reject the second and third sitting of a level, so
-- it has to go before any of them can be created.
DROP INDEX IF EXISTS "Space_branchId_level_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Space_branchId_level_sessionSlot_key"
  ON "Space" ("branchId", "level", "sessionSlot");

-- ---------------------------------------------------------------------------
-- 2. Message
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Message" (
  "id"             TEXT NOT NULL,
  "channelId"      TEXT NOT NULL,
  "authorId"       TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "replyToId"      TEXT,
  "attachmentUrl"  TEXT,
  "attachmentType" TEXT,
  "attachmentName" TEXT,
  "hiddenAt"       TIMESTAMP(3),
  "hiddenById"     TEXT,
  "hiddenReason"   TEXT,
  "editedAt"       TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"       TEXT,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- The only access pattern that matters: the newest page of one channel.
CREATE INDEX IF NOT EXISTS "Message_channelId_createdAt_idx" ON "Message" ("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_authorId_idx"            ON "Message" ("authorId");
CREATE INDEX IF NOT EXISTS "Message_tenantId_idx"            ON "Message" ("tenantId");

-- Foreign keys, each wrapped so a re-run is a no-op rather than an error.
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SET NULL, not CASCADE: deleting a quoted message must not take the replies
-- with it. The reply still says something on its own.
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey"
    FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_hiddenById_fkey"
    FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. Carry the forum across
-- ---------------------------------------------------------------------------
--
-- Guarded on Thread still existing, so this migration is safe to apply to a
-- database that never had the forum — and safe to re-run, since both inserts
-- skip ids that are already present.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Thread') THEN

    -- A thread becomes its opening message. The title is folded into the body
    -- rather than dropped: it was often the entire question, and a bubble that
    -- silently loses half of what somebody wrote is worse than a slightly long
    -- first line.
    INSERT INTO "Message" ("id", "channelId", "authorId", "body", "createdAt", "updatedAt", "tenantId")
    SELECT
      t."id",
      t."channelId",
      t."authorId",
      CASE
        WHEN COALESCE(t."title", '') = '' THEN t."body"
        WHEN t."body" LIKE t."title" || '%' THEN t."body"
        ELSE t."title" || E'\n' || t."body"
      END,
      t."createdAt",
      t."updatedAt",
      t."tenantId"
    FROM "Thread" t
    WHERE NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."id" = t."id");

    -- A comment becomes a reply quoting the thread's opening message. The
    -- nesting is deliberately flattened: `parentId` chains could go arbitrarily
    -- deep and there is nowhere to render that on a phone.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Comment') THEN
      INSERT INTO "Message" ("id", "channelId", "authorId", "body", "replyToId", "createdAt", "updatedAt", "tenantId")
      SELECT
        c."id",
        t."channelId",
        c."authorId",
        c."body",
        t."id",
        c."createdAt",
        c."updatedAt",
        c."tenantId"
      FROM "Comment" c
      JOIN "Thread" t ON t."id" = c."threadId"
      WHERE NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."id" = c."id");
    END IF;

  END IF;
END $$;

DROP TABLE IF EXISTS "Comment";
DROP TABLE IF EXISTS "Thread";

-- ---------------------------------------------------------------------------
-- 4. Assignments follow the sitting too
-- ---------------------------------------------------------------------------
--
-- NULL means "every sitting at this level", which is exactly how assignments
-- behaved before sessions became a boundary — so every existing row keeps
-- reaching the same students it always did. A tutor who wants to set homework
-- for their own morning class can now say so.

ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "sessionSlot" TEXT;

CREATE INDEX IF NOT EXISTS "Assignment_level_sessionSlot_idx"
  ON "Assignment" ("level", "sessionSlot");
