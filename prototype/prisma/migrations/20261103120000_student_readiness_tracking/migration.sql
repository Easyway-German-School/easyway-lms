-- Placement-track tagging and readiness scoring (nursing pipeline, first
-- career track). careerTrack is admin-set only, never self-declared at
-- signup; readinessScore/Tag are a cached snapshot src/lib/readiness.ts
-- recomputes on demand and nightly.

ALTER TABLE "Student"
ADD COLUMN IF NOT EXISTS "careerTrack" TEXT;

ALTER TABLE "Student"
ADD COLUMN IF NOT EXISTS "readinessScore" INTEGER;

ALTER TABLE "Student"
ADD COLUMN IF NOT EXISTS "readinessTag" TEXT;

ALTER TABLE "Student"
ADD COLUMN IF NOT EXISTS "readinessComputedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Student_careerTrack_idx" ON "Student"("careerTrack");
