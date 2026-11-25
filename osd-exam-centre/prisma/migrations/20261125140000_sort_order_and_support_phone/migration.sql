-- Manual sitting order (A1→C2 by default) + phone on help requests.

ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Seed existing sittings by CEFR difficulty so the public list already reads
-- A1 → A2 → B1 → B2 → C1 → C2 without the office having to drag anything.
UPDATE "ExamSession" SET "sortOrder" = CASE UPPER(TRIM("level"))
  WHEN 'A1' THEN 10
  WHEN 'A2' THEN 20
  WHEN 'B1' THEN 30
  WHEN 'B2' THEN 40
  WHEN 'C1' THEN 50
  WHEN 'C2' THEN 60
  ELSE 100
END
WHERE "sortOrder" = 0;

CREATE INDEX IF NOT EXISTS "ExamSession_sortOrder_idx" ON "ExamSession"("sortOrder");

ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "phone" TEXT;
