-- Splits "hybrid" delivery mode into two concrete sittings: a physical slot
-- (the existing Student.sessionSlot) and a new online slot. Also tags a
-- StudentCoTutor row with which half of a hybrid combo it covers, so
-- materials/portal can attribute uploads to "your online tutor" vs "your
-- physical tutor". See lib/hybrid-combo.ts and lib/lecturer-assignment.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "hybridOnlineSlot" TEXT;
ALTER TABLE "StudentCoTutor" ADD COLUMN IF NOT EXISTS "role" TEXT;
