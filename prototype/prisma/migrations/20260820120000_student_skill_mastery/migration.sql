CREATE TABLE "StudentSkillMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastScore" INTEGER,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,
    CONSTRAINT "StudentSkillMastery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentSkillMastery_studentId_skill_key" ON "StudentSkillMastery"("studentId", "skill");
CREATE INDEX "StudentSkillMastery_tenantId_skill_mastery_idx" ON "StudentSkillMastery"("tenantId", "skill", "mastery");
ALTER TABLE "StudentSkillMastery" ADD CONSTRAINT "StudentSkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentSkillMastery" ADD CONSTRAINT "StudentSkillMastery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
