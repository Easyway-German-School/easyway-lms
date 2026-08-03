-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClassRecording" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lecturer" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Pathway" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "model" TEXT,
    "recordId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "affectedCount" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "source" TEXT NOT NULL DEFAULT 'app',
    "ip" TEXT,
    "userAgent" TEXT,
    "route" TEXT,
    "requestId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "restorable" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "snapshotId" TEXT,
    "sizeBytes" BIGINT,
    "detail" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_model_recordId_idx" ON "AuditLog"("model", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");

-- CreateIndex
CREATE INDEX "AuditLog_severity_at_idx" ON "AuditLog"("severity", "at");

-- CreateIndex
CREATE INDEX "AuditLog_restorable_at_idx" ON "AuditLog"("restorable", "at");

-- CreateIndex
CREATE INDEX "BackupRun_kind_status_startedAt_idx" ON "BackupRun"("kind", "status", "startedAt");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Partial indexes for the soft-delete filter.
--
-- Every ordinary read on these tables now carries `WHERE "deletedAt" IS NULL`.
-- A partial index costs nothing for the deleted rows and keeps the common
-- case — almost every row is live — on an index scan rather than a seq scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "User_live_idx"           ON "User"           ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Student_live_idx"        ON "Student"        ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Lecturer_live_idx"       ON "Lecturer"       ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Branch_live_idx"         ON "Branch"         ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Class_live_idx"          ON "Class"          ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Course_live_idx"         ON "Course"         ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Pathway_live_idx"        ON "Pathway"        ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Material_live_idx"       ON "Material"       ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ClassRecording_live_idx" ON "ClassRecording" ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Invoice_live_idx"        ON "Invoice"        ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Payment_live_idx"        ON "Payment"        ("id") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Certificate_live_idx"    ON "Certificate"    ("id") WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- The audit trail is append-only, and Postgres is what enforces it.
--
-- The guard in the application refuses to update or delete an AuditLog row,
-- but the application is the thing most likely to be compromised: a leaked
-- admin session, a stolen DATABASE_URL, a bad script run against production
-- from somebody's laptop. An attacker who can write to this database can
-- delete the record of what they did, and a trail that can be edited by the
-- person being audited is decoration.
--
-- So the rule lives below the application, in the engine. UPDATE may touch
-- only the three restore-bookkeeping columns; nothing may DELETE without the
-- session first setting `easyway.audit_prune`, which is deliberately awkward
-- and is documented in docs/SECURITY.md as a two-person operation for the
-- data-retention job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION easyway_audit_immutable() RETURNS trigger AS $easyway$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('easyway.audit_prune', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'AuditLog is append-only: delete refused. Retention pruning must SET LOCAL easyway.audit_prune = ''on'' first (see docs/SECURITY.md).';
    END IF;
    RETURN OLD;
  END IF;

  -- Everything except the restore bookkeeping must be byte-identical. Done as
  -- a jsonb comparison so that a column added to this table later is covered
  -- automatically rather than silently becoming editable.
  IF (to_jsonb(NEW) - 'restorable' - 'restoredAt' - 'restoredById')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'restorable' - 'restoredAt' - 'restoredById') THEN
    RAISE EXCEPTION
      'AuditLog is append-only: only restorable/restoredAt/restoredById may be updated (attempted on row %).', OLD.id;
  END IF;

  RETURN NEW;
END;
$easyway$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuditLog_immutable" ON "AuditLog";
CREATE TRIGGER "AuditLog_immutable"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION easyway_audit_immutable();
