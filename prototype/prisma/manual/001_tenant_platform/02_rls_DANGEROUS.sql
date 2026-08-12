-- ---------------------------------------------------------------------------
-- 3. Row-level security.
-- ---------------------------------------------------------------------------
-- The outer of the two isolation layers. The Prisma extension in
-- src/lib/tenant/client.ts covers code that goes through Prisma; this covers
-- everything else, including raw SQL, a psql session, and any future service
-- that talks to this database directly.
--
-- The policy compares against a per-transaction setting. current_setting(...,
-- true) returns NULL when it has not been set, and `"tenantId" = NULL` matches
-- no rows — so an unset tenant sees nothing rather than everything. That
-- failure direction is the entire point and must not be "helpfully" changed.
--
-- FORCE is included so the table owner is subject to the policy too. Without
-- it, the role Prisma connects as would bypass all of this and the layer would
-- be decorative.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'Student','Lecturer','Branch','Class','ClassSession','PrivateClass',
    'Course','Module','Lesson','Material','Pathway','Enrollment','Progress',
    'Completion','Grade','Assignment','AssignmentTarget','AssignmentSubmission',
    'Attendance','Exam','ExamRegistration','Certificate','Invoice','Payment',
    'Lead','Notification','NotificationSetting','EmailLog','EmailMessage',
    'EmailSuppression','PushSubscription','Space','Channel','ChannelRead',
    'Thread','Comment','ClassRecording','VideoProgress','MissionProgress',
    'PersonalizedPlan','JourneyEvent','IntegrationConnector','AdminAction',
    'AuditLog','BackupRun','User',
    -- The live quiz game. A game row holds a PIN that admits somebody to it and
    -- a frozen copy of one school's question paper; the other two hold one
    -- school's children by name, their scores, and how long each of them took
    -- to answer. Same category as a live class join code.
    'QuizGame','QuizGamePlayer','QuizGameAnswer'
  ];
  -- NOTE: this list is hand-maintained and has fallen behind the schema —
  -- LiveClassSession, LiveClassInvite, SupportTicket, SupportTicketMessage,
  -- Message, ClassRecording and the billing tables are all tenant-owned per
  -- src/lib/tenant/registry.ts and are all missing above. Reconcile against
  -- TENANT_OWNED_MODELS before this is ever run.
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))
    $p$, t);
  END LOOP;
END $$;
