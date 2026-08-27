-- Additive only: two nullable columns on Material, one new table, three indexes, two foreign keys.
-- See src/lib/tenant/registry.ts and prisma/schema.prisma's MaterialQuestAttempt model.

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "questsReviewedAt" TIMESTAMP(3);
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "questsReviewedBy" TEXT;

CREATE TABLE IF NOT EXISTS "MaterialQuestAttempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "questIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "MaterialQuestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaterialQuestAttempt_tenantId_idx" ON "MaterialQuestAttempt"("tenantId");

CREATE INDEX IF NOT EXISTS "MaterialQuestAttempt_studentId_idx" ON "MaterialQuestAttempt"("studentId");

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialQuestAttempt_studentId_materialId_questIndex_key" ON "MaterialQuestAttempt"("studentId", "materialId", "questIndex");

DO $$ BEGIN
  ALTER TABLE "MaterialQuestAttempt" ADD CONSTRAINT "MaterialQuestAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MaterialQuestAttempt" ADD CONSTRAINT "MaterialQuestAttempt_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MaterialQuestAttempt" ADD CONSTRAINT "MaterialQuestAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
