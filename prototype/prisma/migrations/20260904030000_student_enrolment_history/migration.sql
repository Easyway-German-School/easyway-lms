-- Per-level enrolment history — one row per student x level x batch, across
-- every year. See model StudentEnrolment in schema.prisma for why this
-- exists. Hand-written and idempotent (see prisma/manual — `migrate dev` is
-- banned on this project, it dies replaying multi-tenant history into a
-- shadow DB).

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentEnrolment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "branchId" TEXT,
    "tutorId" TEXT,
    "sessionSlot" TEXT NOT NULL,
    "classType" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "batchMonth" TEXT,
    "batchYear" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT 'ongoing',
    "outcomeNote" TEXT,
    "tuitionChargeId" TEXT,
    "feeSnapshot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT,

    CONSTRAINT "StudentEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentEnrolment_studentId_startedAt_idx" ON "StudentEnrolment"("studentId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentEnrolment_tenantId_batchYear_level_idx" ON "StudentEnrolment"("tenantId", "batchYear", "level");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentEnrolment" ADD CONSTRAINT "StudentEnrolment_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentEnrolment" ADD CONSTRAINT "StudentEnrolment_branchId_fkey"
        FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentEnrolment" ADD CONSTRAINT "StudentEnrolment_tutorId_fkey"
        FOREIGN KEY ("tutorId") REFERENCES "Lecturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentEnrolment" ADD CONSTRAINT "StudentEnrolment_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
