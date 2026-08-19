CREATE TABLE "StudentAiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentAiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentAiUsage_userId_kind_day_key" ON "StudentAiUsage"("userId", "kind", "day");
CREATE INDEX "StudentAiUsage_tenantId_day_idx" ON "StudentAiUsage"("tenantId", "day");

ALTER TABLE "StudentAiUsage" ADD CONSTRAINT "StudentAiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentAiUsage" ADD CONSTRAINT "StudentAiUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
