-- A student the office will not sign off for advancement — failed
-- assessment, unresolved fees, whatever the reason. Lets the cohort console
-- ("/admin/journey") stop sweeping the same name into every batch's bulk
-- sign-off. heldBackAt null means not held back.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "heldBackAt" TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "heldBackReason" TEXT;
