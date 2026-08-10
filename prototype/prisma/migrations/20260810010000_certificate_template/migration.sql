-- The wording, signatories and colours printed on a certificate.
--
-- One row per school. Everything the document says other than the student's own
-- facts used to be hardcoded in the React component, which made a change of
-- Head of Department a code change and a deploy.
--
-- ONE JSONB COLUMN, NOT THIRTY TEXT COLUMNS. The shape is small, always read
-- as a whole, and never queried across rows — no query will ever ask "which
-- schools use red". Columns would therefore buy nothing and cost a migration
-- every time the design gains a line. src/lib/certificate-template.ts parses
-- the blob and merges it over the defaults, so a row saved before a field
-- existed still renders a complete document.
--
-- NULL settings is the "created but never edited" state and is valid: the
-- parser returns the full default template for it.
--
-- No row is inserted here. Absence means "never customised", which the editor
-- reports differently from "edited back to the defaults" — so seeding a
-- default row would destroy a distinction the UI depends on.

CREATE TABLE IF NOT EXISTS "CertificateTemplate" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL DEFAULT 'default',
    "settings"  JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId"  TEXT,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CertificateTemplate_tenantId_idx" ON "CertificateTemplate"("tenantId");
CREATE INDEX IF NOT EXISTS "CertificateTemplate_key_idx" ON "CertificateTemplate"("key");

-- ON DELETE CASCADE: a school being removed takes its certificate wording with
-- it. The certificates themselves are soft-deleted and keep their own
-- snapshotted text, so nothing already issued is affected by this.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CertificateTemplate_tenantId_fkey'
    ) THEN
        ALTER TABLE "CertificateTemplate"
            ADD CONSTRAINT "CertificateTemplate_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
