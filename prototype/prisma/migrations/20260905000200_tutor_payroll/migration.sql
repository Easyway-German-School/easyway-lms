-- Tutor payroll: a per-tutor rate (TutorPayRate) and a paid-amounts ledger
-- (PayrollPayment). See src/lib/payroll.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

-- CreateTable
CREATE TABLE IF NOT EXISTS "TutorPayRate" (
    "id" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "rateType" TEXT NOT NULL DEFAULT 'per_class',
    "amount" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "TutorPayRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TutorPayRate_lecturerId_key" ON "TutorPayRate" ("lecturerId");
CREATE INDEX IF NOT EXISTS "TutorPayRate_tenantId_idx" ON "TutorPayRate" ("tenantId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollPayment" (
    "id" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "classesCounted" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollPayment_lecturerId_idx" ON "PayrollPayment" ("lecturerId");
CREATE INDEX IF NOT EXISTS "PayrollPayment_tenantId_idx" ON "PayrollPayment" ("tenantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TutorPayRate" ADD CONSTRAINT "TutorPayRate_lecturerId_fkey"
        FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TutorPayRate" ADD CONSTRAINT "TutorPayRate_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_lecturerId_fkey"
        FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
