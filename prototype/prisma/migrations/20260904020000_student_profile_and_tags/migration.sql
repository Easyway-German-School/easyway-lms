-- Structured student profile + admin-authored classification tags.
-- Hand-written and idempotent (see prisma/manual — `migrate dev` is banned on
-- this project, it dies replaying multi-tenant history into a shadow DB).

-- AlterTable
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "phone" TEXT,
    "altPhone" TEXT,
    "whatsapp" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "stateRegion" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationality" TEXT,
    "govIdType" TEXT,
    "govIdNumber" TEXT,
    "photoUrl" TEXT,
    "idProofUrl" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "occupation" TEXT,
    "employer" TEXT,
    "priorEducation" TEXT,
    "priorGermanLevel" TEXT,
    "heardFrom" TEXT,
    "visaStatus" TEXT,
    "passportNumber" TEXT,
    "passportExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentProfile_studentId_key" ON "StudentProfile"("studentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentProfile_tenantId_idx" ON "StudentProfile"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentProfile_city_idx" ON "StudentProfile"("city");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentProfile_country_idx" ON "StudentProfile"("country");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Student_tags_idx" ON "Student"("tags");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
