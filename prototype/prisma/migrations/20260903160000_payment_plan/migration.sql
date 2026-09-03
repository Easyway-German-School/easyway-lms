-- Negotiated instalment schedules for tuition balances. The first-class version
-- of what Student.paymentGraceUntil did by hand: while a plan is `active` and
-- the student is keeping to it, the 30-day part-payment lock is suppressed and
-- the balance-reminder ladder is held. Miss an instalment past its grace and
-- the plan goes `defaulted` — the lock and reminders come back and the
-- accountant is notified. See the model comment in prisma/schema.prisma and
-- src/lib/payment-plans.ts.
--
-- Hand-written and idempotent, per prisma/manual/README. `migrate deploy` runs
-- on every Vercel build. Never run `prisma migrate dev` against this database.

CREATE TABLE IF NOT EXISTS "PaymentPlan" (
  "id"           TEXT NOT NULL,
  "studentId"    TEXT NOT NULL,
  "chargeIds"    JSONB NOT NULL,
  "installments" JSONB NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'active',
  "graceDays"    INTEGER NOT NULL DEFAULT 3,
  "startingPaid" INTEGER NOT NULL DEFAULT 0,
  "createdById"  TEXT,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "defaultedAt"  TIMESTAMP(3),
  "completedAt"  TIMESTAMP(3),
  "deletedAt"    TIMESTAMP(3),
  "tenantId"     TEXT,

  CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentPlan_studentId_status_idx" ON "PaymentPlan"("studentId", "status");
CREATE INDEX IF NOT EXISTS "PaymentPlan_tenantId_idx" ON "PaymentPlan"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentPlan_studentId_fkey'
  ) THEN
    ALTER TABLE "PaymentPlan"
      ADD CONSTRAINT "PaymentPlan_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentPlan_tenantId_fkey'
  ) THEN
    ALTER TABLE "PaymentPlan"
      ADD CONSTRAINT "PaymentPlan_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
