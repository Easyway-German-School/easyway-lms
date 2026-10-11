-- Unified promo-code system (student referrals + influencer program).
--
-- ReferralRedemption/ReferralHold are NOT touched or dropped — they stay on
-- disk exactly as they are, untouched history. This migration creates four
-- fresh tables and backfills them from the existing data: one PromoCode per
-- Student.referralCode (type 'student_referral'), then every
-- ReferralRedemption/ReferralHold row copied forward with its ORIGINAL id
-- preserved. The application stops reading ReferralRedemption/ReferralHold
-- after this ships; nothing here deletes them.

CREATE TABLE IF NOT EXISTS "PromoCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "ownerStudentId" TEXT,
  "ownerUserId" TEXT,
  "label" TEXT,
  "discountPercent" INTEGER,
  "discountFlat" INTEGER,
  "discountCapAmount" INTEGER,
  "commissionPercent" INTEGER,
  "commissionFlat" INTEGER,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PromoRedemption" (
  "id" TEXT NOT NULL,
  "promoCodeId" TEXT NOT NULL,
  "codeSnapshot" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "redeemedByStudentId" TEXT NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "discountAppliedToChargeId" TEXT,
  "discountAppliedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'registered',
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PromoRedemptionHold" (
  "id" TEXT NOT NULL,
  "redemptionId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "tenantId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromoRedemptionHold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PromoPayout" (
  "id" TEXT NOT NULL,
  "promoRedemptionId" TEXT NOT NULL,
  "promoCodeId" TEXT NOT NULL,
  "paymentId" TEXT,
  "amount" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "creditedViaChargeId" TEXT,
  "creditedNote" TEXT,
  "creditedById" TEXT,
  "creditedAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "PromoPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX IF NOT EXISTS "PromoCode_type_status_idx" ON "PromoCode"("type", "status");
CREATE INDEX IF NOT EXISTS "PromoCode_tenantId_idx" ON "PromoCode"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "PromoRedemption_redeemedByStudentId_key" ON "PromoRedemption"("redeemedByStudentId");
CREATE INDEX IF NOT EXISTS "PromoRedemption_promoCodeId_createdAt_idx" ON "PromoRedemption"("promoCodeId", "createdAt");
CREATE INDEX IF NOT EXISTS "PromoRedemption_status_createdAt_idx" ON "PromoRedemption"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PromoRedemption_tenantId_idx" ON "PromoRedemption"("tenantId");

CREATE INDEX IF NOT EXISTS "PromoRedemptionHold_tenantId_idx" ON "PromoRedemptionHold"("tenantId");
CREATE INDEX IF NOT EXISTS "PromoRedemptionHold_redemptionId_releasedAt_idx" ON "PromoRedemptionHold"("redemptionId", "releasedAt");
CREATE INDEX IF NOT EXISTS "PromoRedemptionHold_heldAt_idx" ON "PromoRedemptionHold"("heldAt");

CREATE INDEX IF NOT EXISTS "PromoPayout_promoCodeId_status_idx" ON "PromoPayout"("promoCodeId", "status");
CREATE INDEX IF NOT EXISTS "PromoPayout_promoRedemptionId_idx" ON "PromoPayout"("promoRedemptionId");
CREATE INDEX IF NOT EXISTS "PromoPayout_tenantId_idx" ON "PromoPayout"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoCode_ownerStudentId_fkey' AND conrelid = '"PromoCode"'::regclass) THEN
    ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_ownerStudentId_fkey" FOREIGN KEY ("ownerStudentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoCode_ownerUserId_fkey' AND conrelid = '"PromoCode"'::regclass) THEN
    ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoCode_createdById_fkey' AND conrelid = '"PromoCode"'::regclass) THEN
    ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoCode_tenantId_fkey' AND conrelid = '"PromoCode"'::regclass) THEN
    ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoRedemption_promoCodeId_fkey' AND conrelid = '"PromoRedemption"'::regclass) THEN
    ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoRedemption_redeemedByStudentId_fkey' AND conrelid = '"PromoRedemption"'::regclass) THEN
    ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_redeemedByStudentId_fkey" FOREIGN KEY ("redeemedByStudentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoRedemptionHold_redemptionId_fkey' AND conrelid = '"PromoRedemptionHold"'::regclass) THEN
    ALTER TABLE "PromoRedemptionHold" ADD CONSTRAINT "PromoRedemptionHold_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "PromoRedemption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_promoRedemptionId_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_promoRedemptionId_fkey" FOREIGN KEY ("promoRedemptionId") REFERENCES "PromoRedemption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_promoCodeId_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_paymentId_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_approvedById_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_creditedById_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_creditedById_fkey" FOREIGN KEY ("creditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoPayout_tenantId_fkey' AND conrelid = '"PromoPayout"'::regclass) THEN
    ALTER TABLE "PromoPayout" ADD CONSTRAINT "PromoPayout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill 1: one PromoCode per existing student referral code. A
-- deterministic id (derived from the student id, not random) so a retried
-- deploy of this migration is a no-op via ON CONFLICT rather than a second
-- scan each time.
INSERT INTO "PromoCode" ("id", "code", "type", "status", "ownerStudentId", "createdAt", "updatedAt")
SELECT 'pc_legacy_' || s."id", s."referralCode", 'student_referral', 'active', s."id", s."createdAt", s."createdAt"
FROM "Student" s
WHERE s."referralCode" IS NOT NULL
ON CONFLICT ("code") DO NOTHING;

-- Backfill 2: copy every ReferralRedemption row forward, preserving its id.
INSERT INTO "PromoRedemption" ("id", "promoCodeId", "codeSnapshot", "type", "redeemedByStudentId", "discountAmount", "status", "tenantId", "createdAt", "updatedAt")
SELECT r."id", 'pc_legacy_' || r."referrerStudentId", r."referralCode", 'student_referral', r."referredStudentId", 0, r."status", r."tenantId", r."createdAt", r."updatedAt"
FROM "ReferralRedemption" r
WHERE EXISTS (SELECT 1 FROM "PromoCode" pc WHERE pc."id" = 'pc_legacy_' || r."referrerStudentId")
ON CONFLICT ("id") DO NOTHING;

-- Backfill 3: copy holds forward (same id, repointed to PromoRedemption).
INSERT INTO "PromoRedemptionHold" ("id", "redemptionId", "reason", "heldAt", "releasedAt", "resolvedById", "tenantId", "createdAt")
SELECT h."id", h."redemptionId", h."reason", h."heldAt", h."releasedAt", h."resolvedById", h."tenantId", h."createdAt"
FROM "ReferralHold" h
WHERE EXISTS (SELECT 1 FROM "PromoRedemption" pr WHERE pr."id" = h."redemptionId")
ON CONFLICT ("id") DO NOTHING;
