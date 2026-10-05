-- Student avatar + chosen portal look.
--
-- Three nullable columns on "Student". Idempotent on purpose, like every
-- migration here: the database may already carry the change from a db push.
--   avatar : jsonb — validated cartoon avatar config (src/lib/avatar.ts)
--   uiLook : text  — "youth" | "classic" | NULL (age rollout decides)
--   lookPromptedAt : when Becca's new-look popup was first shown (once, ever)

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "avatar" JSONB;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "uiLook" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "lookPromptedAt" TIMESTAMP(3);
