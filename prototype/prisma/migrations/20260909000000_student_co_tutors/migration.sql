-- Shared students: an EXTRA tutor on a student, beyond the primary
-- `Student.tutorId`. Online and hybrid students can be taught by more than one
-- tutor once the platform turns on `roster.sharedStudents` for the school. See
-- src/lib/tutor-pairing.ts (setStudentCoTutors) and src/lib/tenant/features.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentCoTutor" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,

    CONSTRAINT "StudentCoTutor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentCoTutor_studentId_lecturerId_key" ON "StudentCoTutor" ("studentId", "lecturerId");
CREATE INDEX IF NOT EXISTS "StudentCoTutor_lecturerId_idx" ON "StudentCoTutor" ("lecturerId");
CREATE INDEX IF NOT EXISTS "StudentCoTutor_studentId_idx" ON "StudentCoTutor" ("studentId");
CREATE INDEX IF NOT EXISTS "StudentCoTutor_tenantId_idx" ON "StudentCoTutor" ("tenantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentCoTutor" ADD CONSTRAINT "StudentCoTutor_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentCoTutor" ADD CONSTRAINT "StudentCoTutor_lecturerId_fkey"
        FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentCoTutor" ADD CONSTRAINT "StudentCoTutor_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
