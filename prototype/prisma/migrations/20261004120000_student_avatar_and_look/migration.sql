-- Student avatar + chosen portal look.
--
-- Two nullable columns on "Student". Idempotent on purpose, like every
-- migration here: the database may already carry the change from a db push.
--   avatar : jsonb — validated cartoon avatar config (src/lib/avatar.ts)
--   uiLook : text  — "youth" | "classic" | NULL (age rollout decides)

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "avatar" JSONB;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "uiLook" TEXT;
