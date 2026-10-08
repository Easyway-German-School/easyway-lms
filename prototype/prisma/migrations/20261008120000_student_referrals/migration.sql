ALTER TABLE "Student"
ADD COLUMN "referralCode" TEXT;

WITH numbered_students AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS sequence
  FROM "Student"
)
UPDATE "Student" AS student
SET "referralCode" = 'EW' || numbered_students.sequence::TEXT
FROM numbered_students
WHERE student."id" = numbered_students."id";

CREATE UNIQUE INDEX "Student_referralCode_key" ON "Student"("referralCode");

CREATE TABLE "ReferralRedemption" (
  "id" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'registered',
  "referrerStudentId" TEXT NOT NULL,
  "referredStudentId" TEXT NOT NULL,
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReferralRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralHold" (
  "id" TEXT NOT NULL,
  "redemptionId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralRedemption_referredStudentId_key"
ON "ReferralRedemption"("referredStudentId");
CREATE INDEX "ReferralRedemption_tenantId_idx" ON "ReferralRedemption"("tenantId");
CREATE INDEX "ReferralRedemption_referrerStudentId_createdAt_idx"
ON "ReferralRedemption"("referrerStudentId", "createdAt");
CREATE INDEX "ReferralRedemption_status_createdAt_idx"
ON "ReferralRedemption"("status", "createdAt");
CREATE INDEX "ReferralHold_tenantId_idx" ON "ReferralHold"("tenantId");
CREATE INDEX "ReferralHold_redemptionId_releasedAt_idx"
ON "ReferralHold"("redemptionId", "releasedAt");
CREATE INDEX "ReferralHold_heldAt_idx" ON "ReferralHold"("heldAt");

ALTER TABLE "ReferralRedemption"
ADD CONSTRAINT "ReferralRedemption_referrerStudentId_fkey"
FOREIGN KEY ("referrerStudentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralRedemption"
ADD CONSTRAINT "ReferralRedemption_referredStudentId_fkey"
FOREIGN KEY ("referredStudentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralHold"
ADD CONSTRAINT "ReferralHold_redemptionId_fkey"
FOREIGN KEY ("redemptionId") REFERENCES "ReferralRedemption"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
