ALTER TABLE "Payment" ADD COLUMN "tuitionChargeId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "paystackReference" TEXT;

CREATE UNIQUE INDEX "Payment_paystackReference_key" ON "Payment"("paystackReference");
CREATE INDEX "Payment_tuitionChargeId_idx" ON "Payment"("tuitionChargeId");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_tuitionChargeId_fkey"
FOREIGN KEY ("tuitionChargeId") REFERENCES "TuitionCharge"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TuitionCharge" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TuitionCharge" ADD COLUMN "requestKey" TEXT;

DROP INDEX "TuitionCharge_studentId_level_key";
CREATE UNIQUE INDEX "TuitionCharge_studentId_level_attempt_key"
ON "TuitionCharge"("studentId", "level", "attempt");
CREATE UNIQUE INDEX "TuitionCharge_requestKey_key" ON "TuitionCharge"("requestKey");
