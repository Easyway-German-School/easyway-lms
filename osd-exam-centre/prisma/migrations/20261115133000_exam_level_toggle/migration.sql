-- Per-level on/off switch so the office can take a whole exam level (e.g.
-- C1/C2, not offered yet) off the public booking page without touching,
-- deleting or unpublishing every individual sitting of that level.
-- Every level starts enabled except C1 and C2, which start OFF — Easyway
-- isn't running those yet. Toggle them on later from the admin panel, don't
-- re-run this.
-- Written idempotent so a partial re-run is harmless.

CREATE TABLE IF NOT EXISTS "ExamLevelSetting" (
  "level" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ExamLevelSetting_pkey" PRIMARY KEY ("level")
);

INSERT INTO "ExamLevelSetting" ("level", "enabled") VALUES
  ('A1', true),
  ('A2', true),
  ('B1', true),
  ('B2', true),
  ('C1', false),
  ('C2', false)
ON CONFLICT ("level") DO NOTHING;
