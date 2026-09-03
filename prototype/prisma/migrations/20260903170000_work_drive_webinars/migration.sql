-- Work Drive, Phase 4: webinars.
--
-- A webinar is a WorkEvent(kind='webinar') plus this delivery row: a LiveKit
-- room, a public landing page, and a Q&A. Registrations are EventAttendee rows
-- (Phase 3), so nothing new is needed for those.
--
-- Hand-written and idempotent, per prisma/manual/README. No backfill.

CREATE TABLE IF NOT EXISTS "Webinar" (
  "id"                   TEXT NOT NULL,
  "eventId"              TEXT NOT NULL,
  "roomName"             TEXT NOT NULL,
  "mode"                 TEXT NOT NULL DEFAULT 'webinar',
  "audience"             TEXT NOT NULL DEFAULT 'staff',
  "registrationRequired" BOOLEAN NOT NULL DEFAULT true,
  "registrationOpensAt"  TIMESTAMP(3),
  "registrationClosesAt" TIMESTAMP(3),
  "capacity"             INTEGER,
  "landingSlug"          TEXT,
  "landingConfig"        JSONB,
  "allowQuestions"       BOOLEAN NOT NULL DEFAULT true,
  "allowChat"            BOOLEAN NOT NULL DEFAULT true,
  "recordAutomatically"  BOOLEAN NOT NULL DEFAULT true,
  "recordingId"          TEXT,
  "startedAt"            TIMESTAMP(3),
  "endedAt"              TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"            TIMESTAMP(3),
  "tenantId"             TEXT,
  CONSTRAINT "Webinar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebinarQuestion" (
  "id"            TEXT NOT NULL,
  "webinarId"     TEXT NOT NULL,
  "askedByUserId" TEXT,
  "askedByName"   TEXT,
  "body"          TEXT NOT NULL,
  "upvotes"       INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "answeredById"  TEXT,
  "answeredAt"    TIMESTAMP(3),
  "answerText"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      TEXT,
  CONSTRAINT "WebinarQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebinarQuestionVote" (
  "id"         TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "voterKey"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"   TEXT,
  CONSTRAINT "WebinarQuestionVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Webinar_eventId_key" ON "Webinar"("eventId");
CREATE UNIQUE INDEX IF NOT EXISTS "Webinar_roomName_key" ON "Webinar"("roomName");
CREATE INDEX IF NOT EXISTS "Webinar_tenantId_idx" ON "Webinar"("tenantId");
CREATE INDEX IF NOT EXISTS "Webinar_landingSlug_idx" ON "Webinar"("landingSlug");

CREATE INDEX IF NOT EXISTS "WebinarQuestion_webinarId_status_idx" ON "WebinarQuestion"("webinarId", "status");
CREATE INDEX IF NOT EXISTS "WebinarQuestion_tenantId_idx" ON "WebinarQuestion"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "WebinarQuestionVote_questionId_voterKey_key" ON "WebinarQuestionVote"("questionId", "voterKey");
CREATE INDEX IF NOT EXISTS "WebinarQuestionVote_questionId_idx" ON "WebinarQuestionVote"("questionId");
CREATE INDEX IF NOT EXISTS "WebinarQuestionVote_tenantId_idx" ON "WebinarQuestionVote"("tenantId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Webinar_eventId_fkey') THEN
    ALTER TABLE "Webinar" ADD CONSTRAINT "Webinar_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "WorkEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Webinar_tenantId_fkey') THEN
    ALTER TABLE "Webinar" ADD CONSTRAINT "Webinar_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebinarQuestion_webinarId_fkey') THEN
    ALTER TABLE "WebinarQuestion" ADD CONSTRAINT "WebinarQuestion_webinarId_fkey"
      FOREIGN KEY ("webinarId") REFERENCES "Webinar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebinarQuestion_tenantId_fkey') THEN
    ALTER TABLE "WebinarQuestion" ADD CONSTRAINT "WebinarQuestion_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebinarQuestionVote_questionId_fkey') THEN
    ALTER TABLE "WebinarQuestionVote" ADD CONSTRAINT "WebinarQuestionVote_questionId_fkey"
      FOREIGN KEY ("questionId") REFERENCES "WebinarQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebinarQuestionVote_tenantId_fkey') THEN
    ALTER TABLE "WebinarQuestionVote" ADD CONSTRAINT "WebinarQuestionVote_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
