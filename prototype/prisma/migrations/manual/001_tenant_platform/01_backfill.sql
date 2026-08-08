-- Tenant isolation: backfill, then row-level security.
--
-- RUN ORDER MATTERS AND IS NOT OPTIONAL. See README.md in this folder.
-- This file assumes `npx prisma db push` has already added the tenantId
-- columns. Running it before that fails on the first UPDATE, harmlessly.
--
-- Everything here is idempotent: safe to re-run, safe to stop halfway.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The school itself becomes tenant number one.
-- ---------------------------------------------------------------------------
-- Every row currently in this database predates tenancy. Left with a null
-- tenantId they would be invisible to every tenant-scoped query, which would
-- read as "all our data vanished". Assigning them to a real tenant row is what
-- turns the nullable column into an effectively non-null one.

INSERT INTO "Tenant" (id, name, slug, status, "createdAt", "updatedAt")
VALUES ('tenant_easyway_root', 'EasyWay Language School', 'easyway', 'active', NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Backfill every tenant-owned table.
-- ---------------------------------------------------------------------------
-- Looped rather than written out forty-five times. A hand-written list is a
-- list somebody edits later and misses one line of, and a missed line here is
-- a table whose rows belong to nobody.

DO $$
DECLARE
  t text;
  root_id text;
  tables text[] := ARRAY[
    'Student','Lecturer','Branch','Class','ClassSession','PrivateClass',
    'Course','Module','Lesson','Material','Pathway','Enrollment','Progress',
    'Completion','Grade','Assignment','AssignmentTarget','AssignmentSubmission',
    'Attendance','Exam','ExamRegistration','Certificate','Invoice','Payment',
    'Lead','Notification','NotificationSetting','EmailLog','EmailMessage',
    'EmailSuppression','PushSubscription','Space','Channel','ChannelRead',
    'Thread','Comment','ClassRecording','VideoProgress','MissionProgress',
    'PersonalizedPlan','JourneyEvent','IntegrationConnector','AdminAction',
    'AuditLog','BackupRun'
  ];
BEGIN
  SELECT id INTO root_id FROM "Tenant" WHERE slug = 'easyway';

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('UPDATE %I SET "tenantId" = %L WHERE "tenantId" IS NULL', t, root_id);
  END LOOP;

  -- Users too. The column already existed here, but the existing rows never
  -- had it set.
  EXECUTE format('UPDATE "User" SET "tenantId" = %L WHERE "tenantId" IS NULL', root_id);
END $$;

COMMIT;
