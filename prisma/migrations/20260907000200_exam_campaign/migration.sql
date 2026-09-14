-- CreateTable
CREATE TABLE "ExamCampaignResponse" (
    "id" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentId" TEXT,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "enquired" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMP(3),
    "enquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "ExamCampaignResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamCampaignResponse_tenantId_campaignKey_idx" ON "ExamCampaignResponse"("tenantId", "campaignKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExamCampaignResponse_userId_campaignKey_key" ON "ExamCampaignResponse"("userId", "campaignKey");

-- AddForeignKey
ALTER TABLE "ExamCampaignResponse" ADD CONSTRAINT "ExamCampaignResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCampaignResponse" ADD CONSTRAINT "ExamCampaignResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
