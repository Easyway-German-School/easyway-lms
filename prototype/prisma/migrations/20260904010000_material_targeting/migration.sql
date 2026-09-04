-- Office material targeting.
--
-- A tutor uploading through their own portal owns the material via
-- Material.lecturerId and it reaches their roster. An admin has no single
-- roster, so an office upload instead describes the cohort it is for: a level
-- (Material.level already existed) plus, optionally, one branch, one sitting
-- and one intake batch. Any column left NULL means "no restriction on that
-- axis". The tutor portal reads these the same way it reads a tutor's own
-- assignment, so an office upload for "Lagos / A1 / morning" surfaces for every
-- tutor whose assignment covers it and for nobody else.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "sessionSlot" TEXT;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "batch" TEXT;

-- Default true so every pre-existing row, and every ordinary tutor upload,
-- stays visible to students exactly as before. An office sets it false to hand
-- a resource to staff only.
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "visibleToStudents" BOOLEAN NOT NULL DEFAULT true;

-- The tutor portal looks office uploads up by their target branch.
CREATE INDEX IF NOT EXISTS "Material_branchId_idx" ON "Material" ("branchId");
