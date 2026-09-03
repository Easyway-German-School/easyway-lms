-- Work Drive, Phase 3: the staff calendar.
--
-- Staff meetings, deadlines, training days, events and (Phase 4) webinars.
-- WorkEvent is the entry; it can belong to a Workspace or stand alone for the
-- whole tenant. EventAttendee covers both internal staff (userId) and external
-- guests (externalName/externalEmail, used by public webinar registration).
-- EventTask is the planning checklist, EventResource attaches Work Drive files.
--
-- Hand-written and idempotent, per prisma/manual/README. No backfill.

CREATE TABLE IF NOT EXISTS "WorkEvent" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT,
  "branchId"      TEXT,
  "title"         TEXT NOT NULL,
  "description"   TEXT,
  "kind"          TEXT NOT NULL DEFAULT 'meeting',
  "location"      TEXT,
  "startAt"       TIMESTAMP(3) NOT NULL,
  "endAt"         TIMESTAMP(3),
  "allDay"        BOOLEAN NOT NULL DEFAULT false,
  "rrule"         TEXT,
  "timezone"      TEXT NOT NULL DEFAULT 'UTC',
  "visibility"    TEXT NOT NULL DEFAULT 'staff',
  "status"        TEXT NOT NULL DEFAULT 'scheduled',
  "coverImageKey" TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"     TIMESTAMP(3),
  "tenantId"      TEXT,
  CONSTRAINT "WorkEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventAttendee" (
  "id"                 TEXT NOT NULL,
  "eventId"            TEXT NOT NULL,
  "userId"             TEXT,
  "externalName"       TEXT,
  "externalEmail"      TEXT,
  "response"           TEXT NOT NULL DEFAULT 'invited',
  "role"               TEXT NOT NULL DEFAULT 'attendee',
  "checkInAt"          TIMESTAMP(3),
  "reminderSentAt"     TIMESTAMP(3),
  "registrationSource" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"           TEXT,
  CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventTask" (
  "id"         TEXT NOT NULL,
  "eventId"    TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "assigneeId" TEXT,
  "dueAt"      TIMESTAMP(3),
  "done"       BOOLEAN NOT NULL DEFAULT false,
  "doneAt"     TIMESTAMP(3),
  "doneById"   TEXT,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"  TIMESTAMP(3),
  "tenantId"   TEXT,
  CONSTRAINT "EventTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventResource" (
  "id"                 TEXT NOT NULL,
  "eventId"            TEXT NOT NULL,
  "fileId"             TEXT NOT NULL,
  "label"              TEXT,
  "visibleToAttendees" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"           TEXT,
  CONSTRAINT "EventResource_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "WorkEvent_tenantId_startAt_idx" ON "WorkEvent"("tenantId", "startAt");
CREATE INDEX IF NOT EXISTS "WorkEvent_workspaceId_idx" ON "WorkEvent"("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkEvent_tenantId_status_idx" ON "WorkEvent"("tenantId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "EventAttendee_eventId_userId_key" ON "EventAttendee"("eventId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "EventAttendee_eventId_externalEmail_key" ON "EventAttendee"("eventId", "externalEmail");
CREATE INDEX IF NOT EXISTS "EventAttendee_eventId_idx" ON "EventAttendee"("eventId");
CREATE INDEX IF NOT EXISTS "EventAttendee_tenantId_idx" ON "EventAttendee"("tenantId");

CREATE INDEX IF NOT EXISTS "EventTask_eventId_idx" ON "EventTask"("eventId");
CREATE INDEX IF NOT EXISTS "EventTask_tenantId_idx" ON "EventTask"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "EventResource_eventId_fileId_key" ON "EventResource"("eventId", "fileId");
CREATE INDEX IF NOT EXISTS "EventResource_eventId_idx" ON "EventResource"("eventId");
CREATE INDEX IF NOT EXISTS "EventResource_tenantId_idx" ON "EventResource"("tenantId");

-- Foreign keys (guarded)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkEvent_workspaceId_fkey') THEN
    ALTER TABLE "WorkEvent" ADD CONSTRAINT "WorkEvent_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkEvent_tenantId_fkey') THEN
    ALTER TABLE "WorkEvent" ADD CONSTRAINT "WorkEvent_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventAttendee_eventId_fkey') THEN
    ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "WorkEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventAttendee_tenantId_fkey') THEN
    ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventTask_eventId_fkey') THEN
    ALTER TABLE "EventTask" ADD CONSTRAINT "EventTask_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "WorkEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventTask_tenantId_fkey') THEN
    ALTER TABLE "EventTask" ADD CONSTRAINT "EventTask_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventResource_eventId_fkey') THEN
    ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "WorkEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventResource_fileId_fkey') THEN
    ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "DriveFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventResource_tenantId_fkey') THEN
    ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
