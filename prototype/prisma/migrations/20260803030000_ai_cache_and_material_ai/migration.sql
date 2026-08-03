-- Cache what the model produces, and hang its output off the material.
--
-- Additive only. Every existing material reads `aiState = 'none'`, which the
-- UI treats as "not generated yet" and renders exactly as it does today, so
-- this changes nothing until the background job runs.

CREATE TABLE IF NOT EXISTS "AiCache" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "task"      TEXT NOT NULL,
    "value"     JSONB NOT NULL,
    "model"     TEXT,
    "status"    TEXT NOT NULL DEFAULT 'ready',
    "error"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCache_pkey" PRIMARY KEY ("id")
);

-- The unique key IS the feature: a second request for the same thing must
-- find the first one rather than pay for it again.
CREATE UNIQUE INDEX IF NOT EXISTS "AiCache_key_key" ON "AiCache"("key");
CREATE INDEX IF NOT EXISTS "AiCache_task_status_idx" ON "AiCache"("task", "status");

-- The generated output, denormalised onto the material because the students'
-- list reads it on every render.
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiSummary"   TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiKeyPoints" JSONB;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiQuests"    JSONB;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiState"     TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "aiUpdatedAt" TIMESTAMP(3);

-- Finding the next material to work on is the queue's hot query.
CREATE INDEX IF NOT EXISTS "Material_aiState_idx" ON "Material"("aiState");
