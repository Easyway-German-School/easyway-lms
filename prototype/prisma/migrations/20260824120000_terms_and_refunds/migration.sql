-- Terms & Conditions consent trail, and the refund requests it gates.
-- See src/lib/terms.ts / src/lib/terms-content.ts.

CREATE TABLE IF NOT EXISTS "TermsAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "studentId" TEXT,
  "context" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId" TEXT,
  CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TermsAcceptance_userId_createdAt_idx" ON "TermsAcceptance"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TermsAcceptance_tenantId_context_createdAt_idx" ON "TermsAcceptance"("tenantId", "context", "createdAt");
CREATE INDEX IF NOT EXISTS "TermsAcceptance_tenantId_idx" ON "TermsAcceptance"("tenantId");

DO $$ BEGIN
  ALTER TABLE "TermsAcceptance"
    ADD CONSTRAINT "TermsAcceptance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TermsAcceptance"
    ADD CONSTRAINT "TermsAcceptance_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TermsAcceptance"
    ADD CONSTRAINT "TermsAcceptance_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RefundRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "studentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "courseOrPackage" TEXT NOT NULL,
  "paymentReference" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "supportingDocs" JSONB,
  "acceptedTermsVersion" TEXT NOT NULL,
  "acceptedTermsAt" TIMESTAMP(3) NOT NULL,
  "requestedAmount" INTEGER,
  "decisionAmount" INTEGER,
  "decisionNote" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "tenantId" TEXT,
  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RefundRequest_tenantId_status_createdAt_idx" ON "RefundRequest"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "RefundRequest_userId_createdAt_idx" ON "RefundRequest"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RefundRequest_status_idx" ON "RefundRequest"("status");
CREATE INDEX IF NOT EXISTS "RefundRequest_tenantId_idx" ON "RefundRequest"("tenantId");

DO $$ BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
