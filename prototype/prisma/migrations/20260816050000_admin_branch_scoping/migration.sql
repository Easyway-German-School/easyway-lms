-- Admin branch scoping: let a super admin restrict a staff account to
-- specific branches, instead of the "branches" capability being all-or-nothing.
--
-- One nullable JSON column, same shape and same convention as the existing
-- `adminCapabilities` diff column: null (or an empty array, enforced in
-- application code, not here) means unrestricted — every branch, exactly what
-- every admin already has today — so applying this changes nobody's access
-- until a super admin deliberately picks branches for someone.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminBranchIds" JSONB;
