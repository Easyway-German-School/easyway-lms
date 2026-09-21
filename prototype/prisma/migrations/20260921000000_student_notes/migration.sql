-- Free-form student notes (the "+" on My Notes). Additive and idempotent.
CREATE TABLE IF NOT EXISTS "StudentNote" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StudentNote_studentId_updatedAt_idx" ON "StudentNote"("studentId", "updatedAt");
CREATE INDEX IF NOT EXISTS "StudentNote_tenantId_idx" ON "StudentNote"("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentNote_studentId_fkey') THEN
    ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentNote_tenantId_fkey') THEN
    ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
