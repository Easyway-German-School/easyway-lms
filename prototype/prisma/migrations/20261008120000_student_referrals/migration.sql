ALTER TABLE "Student"
ADD COLUMN IF NOT EXISTS "referralCode" TEXT;

UPDATE "Student" AS student
SET "referralCode" = 'EW' || UPPER(MD5(student."id"))
WHERE student."referralCode" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Student_referralCode_key"
ON "Student"("referralCode");

CREATE TABLE IF NOT EXISTS "ReferralRedemption" (
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

CREATE TABLE IF NOT EXISTS "ReferralHold" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralRedemption_referredStudentId_key"
ON "ReferralRedemption"("referredStudentId");
CREATE INDEX IF NOT EXISTS "ReferralRedemption_tenantId_idx" ON "ReferralRedemption"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralRedemption_referrerStudentId_createdAt_idx"
ON "ReferralRedemption"("referrerStudentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReferralRedemption_status_createdAt_idx"
ON "ReferralRedemption"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ReferralHold_tenantId_idx" ON "ReferralHold"("tenantId");
CREATE INDEX IF NOT EXISTS "ReferralHold_redemptionId_releasedAt_idx"
ON "ReferralHold"("redemptionId", "releasedAt");
CREATE INDEX IF NOT EXISTS "ReferralHold_heldAt_idx" ON "ReferralHold"("heldAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReferralRedemption_referrerStudentId_fkey'
      AND conrelid = '"ReferralRedemption"'::regclass
  ) THEN
    ALTER TABLE "ReferralRedemption"
    ADD CONSTRAINT "ReferralRedemption_referrerStudentId_fkey"
    FOREIGN KEY ("referrerStudentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReferralRedemption_referredStudentId_fkey'
      AND conrelid = '"ReferralRedemption"'::regclass
  ) THEN
    ALTER TABLE "ReferralRedemption"
    ADD CONSTRAINT "ReferralRedemption_referredStudentId_fkey"
    FOREIGN KEY ("referredStudentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ReferralHold_redemptionId_fkey'
      AND conrelid = '"ReferralHold"'::regclass
  ) THEN
    ALTER TABLE "ReferralHold"
    ADD CONSTRAINT "ReferralHold_redemptionId_fkey"
    FOREIGN KEY ("redemptionId") REFERENCES "ReferralRedemption"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
