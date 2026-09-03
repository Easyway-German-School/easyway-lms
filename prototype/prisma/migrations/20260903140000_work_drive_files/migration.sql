-- Work Drive, Phase 0: the files pillar.
--
-- A staff-only file store inside the admin portal. The organising unit is a
-- Workspace (a team hub for files + calendar + a live room); folders and files
-- hang off it, versions and extracted text hang off files, and two feeds —
-- FileActivity for the UI, the existing AuditLog for security — record what
-- happened. See prisma/schema.prisma (the WORK DRIVE block) and
-- docs/WORK_DRIVE.md.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before migrations, and `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database. No data
-- backfill — every table starts empty.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Workspace" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "description"      TEXT,
  "icon"             TEXT NOT NULL DEFAULT 'folder',
  "color"            TEXT NOT NULL DEFAULT 'slate',
  "kind"             TEXT NOT NULL DEFAULT 'general',
  "visibility"       TEXT NOT NULL DEFAULT 'private',
  "branchId"         TEXT,
  "createdById"      TEXT,
  "archivedAt"       TIMESTAMP(3),
  "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3),
  "tenantId"         TEXT,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkspaceMember" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "role"        TEXT NOT NULL DEFAULT 'viewer',
  "addedById"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriveFolder" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "parentId"    TEXT,
  "name"        TEXT NOT NULL,
  "path"        TEXT NOT NULL DEFAULT '/',
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3),
  "tenantId"    TEXT,
  CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriveFile" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "folderId"         TEXT,
  "name"             TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL DEFAULT 'application/octet-stream',
  "sizeBytes"        BIGINT NOT NULL DEFAULT 0,
  "storageKey"       TEXT NOT NULL,
  "checksum"         TEXT,
  "kind"             TEXT NOT NULL DEFAULT 'other',
  "currentVersionId" TEXT,
  "createdById"      TEXT,
  "lastModifiedById" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3),
  "tenantId"         TEXT,
  "searchVector"     tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", ''))) STORED,
  CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriveFileVersion" (
  "id"            TEXT NOT NULL,
  "fileId"        TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "storageKey"    TEXT NOT NULL,
  "sizeBytes"     BIGINT NOT NULL DEFAULT 0,
  "checksum"      TEXT,
  "uploadedById"  TEXT,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      TEXT,
  CONSTRAINT "DriveFileVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriveFileText" (
  "id"          TEXT NOT NULL,
  "fileId"      TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,
  CONSTRAINT "DriveFileText_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FileShare" (
  "id"               TEXT NOT NULL,
  "targetType"       TEXT NOT NULL,
  "targetId"         TEXT NOT NULL,
  "sharedById"       TEXT,
  "sharedWithUserId" TEXT NOT NULL,
  "permission"       TEXT NOT NULL DEFAULT 'view',
  "expiresAt"        TIMESTAMP(3),
  "revokedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"         TEXT,
  CONSTRAINT "FileShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FileActivity" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "fileId"      TEXT,
  "folderId"    TEXT,
  "actorId"     TEXT,
  "action"      TEXT NOT NULL,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,
  CONSTRAINT "FileActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FileComment" (
  "id"        TEXT NOT NULL,
  "fileId"    TEXT NOT NULL,
  "authorId"  TEXT,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "tenantId"  TEXT,
  CONSTRAINT "FileComment_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_tenantId_slug_key" ON "Workspace"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "Workspace_tenantId_idx" ON "Workspace"("tenantId");
CREATE INDEX IF NOT EXISTS "Workspace_tenantId_visibility_idx" ON "Workspace"("tenantId", "visibility");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX IF NOT EXISTS "WorkspaceMember_tenantId_idx" ON "WorkspaceMember"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "DriveFolder_workspaceId_parentId_name_key" ON "DriveFolder"("workspaceId", "parentId", "name");
CREATE INDEX IF NOT EXISTS "DriveFolder_workspaceId_idx" ON "DriveFolder"("workspaceId");
CREATE INDEX IF NOT EXISTS "DriveFolder_workspaceId_parentId_idx" ON "DriveFolder"("workspaceId", "parentId");
CREATE INDEX IF NOT EXISTS "DriveFolder_tenantId_idx" ON "DriveFolder"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "DriveFile_currentVersionId_key" ON "DriveFile"("currentVersionId");
CREATE INDEX IF NOT EXISTS "DriveFile_workspaceId_idx" ON "DriveFile"("workspaceId");
CREATE INDEX IF NOT EXISTS "DriveFile_workspaceId_folderId_idx" ON "DriveFile"("workspaceId", "folderId");
CREATE INDEX IF NOT EXISTS "DriveFile_tenantId_idx" ON "DriveFile"("tenantId");
CREATE INDEX IF NOT EXISTS "DriveFile_checksum_idx" ON "DriveFile"("checksum");
CREATE INDEX IF NOT EXISTS "DriveFile_searchVector_idx" ON "DriveFile" USING GIN ("searchVector");

CREATE UNIQUE INDEX IF NOT EXISTS "DriveFileVersion_fileId_versionNumber_key" ON "DriveFileVersion"("fileId", "versionNumber");
CREATE INDEX IF NOT EXISTS "DriveFileVersion_fileId_idx" ON "DriveFileVersion"("fileId");
CREATE INDEX IF NOT EXISTS "DriveFileVersion_tenantId_idx" ON "DriveFileVersion"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "DriveFileText_fileId_key" ON "DriveFileText"("fileId");
CREATE INDEX IF NOT EXISTS "DriveFileText_tenantId_idx" ON "DriveFileText"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "FileShare_targetType_targetId_sharedWithUserId_key" ON "FileShare"("targetType", "targetId", "sharedWithUserId");
CREATE INDEX IF NOT EXISTS "FileShare_sharedWithUserId_revokedAt_idx" ON "FileShare"("sharedWithUserId", "revokedAt");
CREATE INDEX IF NOT EXISTS "FileShare_tenantId_idx" ON "FileShare"("tenantId");

CREATE INDEX IF NOT EXISTS "FileActivity_workspaceId_createdAt_idx" ON "FileActivity"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "FileActivity_fileId_idx" ON "FileActivity"("fileId");
CREATE INDEX IF NOT EXISTS "FileActivity_tenantId_idx" ON "FileActivity"("tenantId");

CREATE INDEX IF NOT EXISTS "FileComment_fileId_createdAt_idx" ON "FileComment"("fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "FileComment_tenantId_idx" ON "FileComment"("tenantId");

-- ---------------------------------------------------------------------------
-- Foreign keys (guarded so a re-run is a no-op)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Workspace_tenantId_fkey') THEN
    ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceMember_workspaceId_fkey') THEN
    ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceMember_tenantId_fkey') THEN
    ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFolder_workspaceId_fkey') THEN
    ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFolder_parentId_fkey') THEN
    ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "DriveFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFolder_tenantId_fkey') THEN
    ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFile_workspaceId_fkey') THEN
    ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFile_folderId_fkey') THEN
    ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "DriveFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFile_currentVersionId_fkey') THEN
    ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_currentVersionId_fkey"
      FOREIGN KEY ("currentVersionId") REFERENCES "DriveFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFile_tenantId_fkey') THEN
    ALTER TABLE "DriveFile" ADD CONSTRAINT "DriveFile_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFileVersion_fileId_fkey') THEN
    ALTER TABLE "DriveFileVersion" ADD CONSTRAINT "DriveFileVersion_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "DriveFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFileVersion_tenantId_fkey') THEN
    ALTER TABLE "DriveFileVersion" ADD CONSTRAINT "DriveFileVersion_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFileText_fileId_fkey') THEN
    ALTER TABLE "DriveFileText" ADD CONSTRAINT "DriveFileText_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "DriveFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriveFileText_tenantId_fkey') THEN
    ALTER TABLE "DriveFileText" ADD CONSTRAINT "DriveFileText_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileShare_tenantId_fkey') THEN
    ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileActivity_workspaceId_fkey') THEN
    ALTER TABLE "FileActivity" ADD CONSTRAINT "FileActivity_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileActivity_tenantId_fkey') THEN
    ALTER TABLE "FileActivity" ADD CONSTRAINT "FileActivity_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileComment_fileId_fkey') THEN
    ALTER TABLE "FileComment" ADD CONSTRAINT "FileComment_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "DriveFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileComment_tenantId_fkey') THEN
    ALTER TABLE "FileComment" ADD CONSTRAINT "FileComment_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
