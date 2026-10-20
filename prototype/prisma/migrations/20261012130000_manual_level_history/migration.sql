ALTER TABLE "TuitionCharge"
ADD COLUMN "historyStatus" TEXT NOT NULL DEFAULT 'confirmed',
ADD COLUMN "historicalPaidAmount" INTEGER NOT NULL DEFAULT 0;

UPDATE "TuitionCharge" AS charge
SET "historyStatus" = 'unreviewed'
FROM "Student" AS student
WHERE charge."studentId" = student."id"
  AND charge."origin" = 'backfill'
  AND UPPER(charge."level") <> UPPER(COALESCE(student."level", 'A1'));
