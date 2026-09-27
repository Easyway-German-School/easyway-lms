-- Panthexa lane + journey engine. Additive except for DROP NOT NULL, which the
-- previous release's code tolerates (it always writes these columns anyway).
-- Written idempotent so a partial re-run is harmless.

ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "expressFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "startTime" TEXT;
ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "arrivalMinutesBefore" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "ExamBooking" ALTER COLUMN "addressLine" DROP NOT NULL;
ALTER TABLE "ExamBooking" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "ExamBooking" ALTER COLUMN "countryOfBirth" DROP NOT NULL;
ALTER TABLE "ExamBooking" ALTER COLUMN "idType" DROP NOT NULL;
ALTER TABLE "ExamBooking" ALTER COLUMN "idNumber" DROP NOT NULL;
ALTER TABLE "ExamBooking" ALTER COLUMN "idExpiry" DROP NOT NULL;

ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "express" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "expressFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "panthexaReference" TEXT;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "amountReceived" INTEGER;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "paidOn" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "infoConfirmedAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "admittedAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "examCompletedAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "resultReleasedAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "certificateReadyAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "certificateDeliveredAt" TIMESTAMP(3);
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "certificateCollection" TEXT;
ALTER TABLE "ExamBooking" ADD COLUMN IF NOT EXISTS "prepInterestAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "ExamBooking_invoiceNumber_key" ON "ExamBooking"("invoiceNumber");

CREATE TABLE IF NOT EXISTS "JourneyEmail" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "attachment" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JourneyEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JourneyEmail_bookingId_step_key" ON "JourneyEmail"("bookingId", "step");
CREATE INDEX IF NOT EXISTS "JourneyEmail_bookingId_idx" ON "JourneyEmail"("bookingId");

DO $$ BEGIN
  ALTER TABLE "JourneyEmail" ADD CONSTRAINT "JourneyEmail_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "ExamBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
