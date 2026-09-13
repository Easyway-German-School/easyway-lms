-- A one-time flag: has this student seen the "come see the new Tutorials
-- page" popup yet. Same shape as the existing welcomeTourSeenAt/
-- storyTourSeenAt columns.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "tutorialsPromoSeenAt" TIMESTAMP(3);
