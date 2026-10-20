-- Stamp each payment with the CEFR level it was recorded against, so an
-- August A1 payment still reads as A1 after the student moves to A2.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "level" TEXT;

CREATE INDEX IF NOT EXISTS "Payment_studentId_level_idx" ON "Payment"("studentId", "level");
