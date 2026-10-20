-- Influencer Program simplification: a partner-type classification
-- (influencer / travel agent / other) and payout bank details, both
-- entered once by the partner themselves or on their behalf by an admin.
--
-- Null partnerType on an existing influencer-type PromoCode reads as
-- "influencer" in application code (the only kind that existed before this
-- migration) — no backfill needed.

ALTER TABLE "PromoCode"
ADD COLUMN IF NOT EXISTS "partnerType" TEXT;

ALTER TABLE "PromoCode"
ADD COLUMN IF NOT EXISTS "payoutBankName" TEXT;

ALTER TABLE "PromoCode"
ADD COLUMN IF NOT EXISTS "payoutAccountNumber" TEXT;

ALTER TABLE "PromoCode"
ADD COLUMN IF NOT EXISTS "payoutAccountName" TEXT;
