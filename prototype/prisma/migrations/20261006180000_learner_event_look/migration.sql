-- Which portal look a learner event happened on.
--
-- One nullable column, so the school can compare the new look and the classic
-- one (and the two community skins) on real behaviour. Idempotent on purpose,
-- like every migration here: the database may already carry the change from a
-- db push.

ALTER TABLE "LearnerUsageEvent" ADD COLUMN IF NOT EXISTS "look" TEXT;
CREATE INDEX IF NOT EXISTS "LearnerUsageEvent_tenantId_look_occurredAt_idx"
  ON "LearnerUsageEvent" ("tenantId", "look", "occurredAt");
