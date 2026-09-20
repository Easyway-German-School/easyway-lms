-- Records who entered a mark. A hybrid student has two tutors, and without
-- this the results page (and every "your tutor graded X" notification) had
-- no way to say which one — see lib/tutor-attribution.ts.
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "lecturerId" TEXT;

DO $$ BEGIN
    ALTER TABLE "Grade" ADD CONSTRAINT "Grade_lecturerId_fkey"
        FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
