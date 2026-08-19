-- Direct 1:1 tutor-student messaging, and the tutor's write-up after each
-- private session. Both are private-tier-only features: the DM thread is
-- keyed on (studentId, tutorId) rather than the branch/level Community
-- Channel/Space model, since a coaching pair isn't a room.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry part
-- of this. Never run `prisma migrate dev` against this database.

CREATE TABLE IF NOT EXISTS "TutorMessage" (
  "id"              TEXT NOT NULL,
  "studentId"       TEXT NOT NULL,
  "tutorId"         TEXT NOT NULL,
  "senderId"        TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "readByStudentAt" TIMESTAMP(3),
  "readByTutorAt"   TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"        TEXT,

  CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TutorMessage_studentId_createdAt_idx" ON "TutorMessage"("studentId", "createdAt");
CREATE INDEX IF NOT EXISTS "TutorMessage_tutorId_createdAt_idx" ON "TutorMessage"("tutorId", "createdAt");
CREATE INDEX IF NOT EXISTS "TutorMessage_tenantId_idx" ON "TutorMessage"("tenantId");

CREATE TABLE IF NOT EXISTS "SessionNote" (
  "id"             TEXT NOT NULL,
  "studentId"      TEXT NOT NULL,
  "tutorId"        TEXT NOT NULL,
  "privateClassId" TEXT,
  "summary"        TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"       TEXT,

  CONSTRAINT "SessionNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SessionNote_studentId_createdAt_idx" ON "SessionNote"("studentId", "createdAt");
CREATE INDEX IF NOT EXISTS "SessionNote_tenantId_idx" ON "SessionNote"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TutorMessage_studentId_fkey') THEN
    ALTER TABLE "TutorMessage"
      ADD CONSTRAINT "TutorMessage_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TutorMessage_tutorId_fkey') THEN
    ALTER TABLE "TutorMessage"
      ADD CONSTRAINT "TutorMessage_tutorId_fkey"
      FOREIGN KEY ("tutorId") REFERENCES "Lecturer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TutorMessage_senderId_fkey') THEN
    ALTER TABLE "TutorMessage"
      ADD CONSTRAINT "TutorMessage_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TutorMessage_tenantId_fkey') THEN
    ALTER TABLE "TutorMessage"
      ADD CONSTRAINT "TutorMessage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionNote_studentId_fkey') THEN
    ALTER TABLE "SessionNote"
      ADD CONSTRAINT "SessionNote_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionNote_tutorId_fkey') THEN
    ALTER TABLE "SessionNote"
      ADD CONSTRAINT "SessionNote_tutorId_fkey"
      FOREIGN KEY ("tutorId") REFERENCES "Lecturer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionNote_privateClassId_fkey') THEN
    ALTER TABLE "SessionNote"
      ADD CONSTRAINT "SessionNote_privateClassId_fkey"
      FOREIGN KEY ("privateClassId") REFERENCES "PrivateClass"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionNote_tenantId_fkey') THEN
    ALTER TABLE "SessionNote"
      ADD CONSTRAINT "SessionNote_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
