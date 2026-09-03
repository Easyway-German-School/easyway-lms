-- The gate on public student signup.
--
-- `/auth/signup` is reached from two WordPress enrolment forms: a returning
-- student arrives with a one-time `token` (minted at POST /api/signup-tokens),
-- a new student with a paid Paystack `?ref=`. One row, two shapes — `token`
-- set for an invite, `paystackRef` set when a paid ref is spent. See the model
-- comment in prisma/schema.prisma and src/lib/signup-access.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README.
-- `migrate deploy` runs on every Vercel build. Never run `prisma migrate dev`
-- against this database.

CREATE TABLE IF NOT EXISTS "SignupToken" (
  "id"           TEXT NOT NULL,
  "token"        TEXT,
  "paystackRef"  TEXT,
  "email"        TEXT NOT NULL,
  "name"         TEXT,
  "phone"        TEXT,
  "branchId"     TEXT,
  "sessionSlot"  TEXT,
  "level"        TEXT,
  "studentType"  TEXT NOT NULL DEFAULT 'returning',
  "source"       TEXT NOT NULL DEFAULT 'wordpress',
  "used"         BOOLEAN NOT NULL DEFAULT false,
  "usedAt"       TIMESTAMP(3),
  "usedByUserId" TEXT,
  "expiresAt"    TIMESTAMP(3),
  "tenantId"     TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SignupToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignupToken_token_key" ON "SignupToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "SignupToken_paystackRef_key" ON "SignupToken"("paystackRef");
CREATE INDEX IF NOT EXISTS "SignupToken_email_idx" ON "SignupToken"("email");
CREATE INDEX IF NOT EXISTS "SignupToken_used_idx" ON "SignupToken"("used");
