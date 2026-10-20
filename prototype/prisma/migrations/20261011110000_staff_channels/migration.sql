-- Staff channels — the Digital Communications piece: persistent, in-app-only
-- staff channels, access computed from role rather than a membership table.

CREATE TABLE IF NOT EXISTS "StaffChannel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "audience" TEXT NOT NULL DEFAULT 'all_staff',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "StaffChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StaffChannelMessage" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "StaffChannelMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StaffChannel_audience_idx" ON "StaffChannel"("audience");
CREATE INDEX IF NOT EXISTS "StaffChannel_tenantId_idx" ON "StaffChannel"("tenantId");

CREATE INDEX IF NOT EXISTS "StaffChannelMessage_channelId_createdAt_idx" ON "StaffChannelMessage"("channelId", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffChannelMessage_tenantId_idx" ON "StaffChannelMessage"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StaffChannel_createdById_fkey' AND conrelid = '"StaffChannel"'::regclass
  ) THEN
    ALTER TABLE "StaffChannel"
    ADD CONSTRAINT "StaffChannel_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StaffChannel_tenantId_fkey' AND conrelid = '"StaffChannel"'::regclass
  ) THEN
    ALTER TABLE "StaffChannel"
    ADD CONSTRAINT "StaffChannel_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StaffChannelMessage_channelId_fkey' AND conrelid = '"StaffChannelMessage"'::regclass
  ) THEN
    ALTER TABLE "StaffChannelMessage"
    ADD CONSTRAINT "StaffChannelMessage_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "StaffChannel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StaffChannelMessage_authorId_fkey' AND conrelid = '"StaffChannelMessage"'::regclass
  ) THEN
    ALTER TABLE "StaffChannelMessage"
    ADD CONSTRAINT "StaffChannelMessage_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StaffChannelMessage_tenantId_fkey' AND conrelid = '"StaffChannelMessage"'::regclass
  ) THEN
    ALTER TABLE "StaffChannelMessage"
    ADD CONSTRAINT "StaffChannelMessage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
