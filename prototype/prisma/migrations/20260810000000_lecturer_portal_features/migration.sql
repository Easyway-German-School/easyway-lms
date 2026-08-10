-- Which optional areas of the tutor portal each tutor may reach.
--
-- Additive, nullable, and NOT backfilled — deliberately. NULL is the "not set"
-- state and `lecturerFeatures()` in src/lib/lecturer-features.ts reads it as
-- every area, so every tutor who exists today keeps exactly the portal they
-- have. Writing '["live_classes","private_classes","recordings"]' into every
-- row would look equivalent and is not: it converts an absent preference into
-- a stated one, so a future change to the default list would silently skip
-- everybody who predates it.
--
-- An empty array IS a real answer and means none of the three. That is why the
-- parser cannot collapse null and [] into the same case.
--
-- Values are drawn from LECTURER_FEATURES: live_classes, private_classes,
-- recordings. Not a CHECK constraint or an enum, because the vocabulary lives
-- in application code alongside its labels and hints, and a database-level copy
-- is a second place to update when a fourth area is added.

ALTER TABLE "Lecturer" ADD COLUMN IF NOT EXISTS "features" JSONB;
