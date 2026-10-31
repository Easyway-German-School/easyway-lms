ALTER TABLE "Payment"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "idempotencyFingerprint" TEXT;

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
