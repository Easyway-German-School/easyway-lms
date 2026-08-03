-- Two-factor authentication for admin accounts.
--
-- Four nullable columns on "User" and nothing else: every existing account
-- keeps working untouched, with two-factor simply not enrolled. There is no
-- backfill and no default to apply, so this takes no table rewrite and no lock
-- worth naming — it is safe to run against the live database during the day.
--
-- Enforcement is NOT switched on by this migration. It is an environment
-- variable (MFA_ENFORCED), because turning it on before anybody has enrolled
-- would lock every super admin out of the screen they enrol on.

-- The TOTP shared secret, encrypted with AES-256-GCM before it gets here.
-- Text rather than bytea because the stored form is a dotted base64url string
-- carrying its own version tag, iv and auth tag: see src/lib/mfa.ts.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT;

-- Null means not enrolled. Holding a secret is not the same as being enrolled:
-- the secret is written when the QR code is shown, and this is written only
-- once a code from it has been proven correct.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP(3);

-- Single-use recovery codes as an array of bcrypt hashes.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpBackupCodes" JSONB;

-- The last accepted time-step, which makes each code usable exactly once
-- rather than for the whole of its 30-second window.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpLastStep" INTEGER;
