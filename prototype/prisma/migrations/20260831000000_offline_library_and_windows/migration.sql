-- Offline library, the 2-week student window, and ready-made notes.
--
-- `Material.aiNotes` holds a written-up study note built from a tutor's
-- uploaded document in the same background pass as `aiSummary`/`aiQuests`
-- (src/lib/material-ai.ts). It lands in a student's "My Notes" hub so the
-- handout arrives already read for them. Gated on the existing
-- `questsReviewedAt` tutor sign-off before a student ever sees it.
--
-- `ClassRecording.studentExpiresAt` is when the recording stops being visible
-- to STUDENTS — set to 14 days after the class on publish. It is a read-side
-- filter only; nothing is deleted, and the assigned tutor and admin keep every
-- recording forever. The AI class notes and the student's own notes survive
-- past it. `keepForever` overrides it.
--
-- Written by hand and idempotent, per prisma/manual: this project used
-- `db push` before it used migrations, so a column may already exist. Never
-- run `prisma migrate dev` against this database.

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiNotes" JSONB;

ALTER TABLE "ClassRecording" ADD COLUMN IF NOT EXISTS "studentExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ClassRecording_studentExpiresAt_idx"
  ON "ClassRecording" ("studentExpiresAt");

-- Backfill: every already-completed recording gets a 14-day student window
-- measured from the class date (falling back to when capture started). Rows
-- that finish after this migration get their stamp from class-recorder.ts.
UPDATE "ClassRecording" r
SET "studentExpiresAt" = COALESCE(
      (SELECT m."recordedAt" FROM "Material" m WHERE m."id" = r."materialId"),
      r."startedAt"
    ) + INTERVAL '14 days'
WHERE r."studentExpiresAt" IS NULL
  AND r."status" = 'completed';
