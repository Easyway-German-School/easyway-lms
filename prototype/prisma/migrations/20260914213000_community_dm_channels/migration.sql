-- Private admin<->student DM channels in the community.
--
-- A DM channel has no Space (it is not any cohort's room), so Channel.spaceId
-- becomes nullable. `dmStudentId` names which student a DM channel is with —
-- unique, because there is exactly one thread per student and every admin who
-- opens it lands in the same one, tagged "Office" like any other staff post.
-- See src/lib/community-spaces.ts (getOrCreateDmChannel, authorizeChannel).
--
-- Hand-written and idempotent, per prisma/manual/001_tenant_platform/README:
-- this project used `db push` before migrations, so the database may already
-- carry parts of any given change. `migrate deploy` runs on every Vercel
-- build. Never run `prisma migrate dev` against this database.

ALTER TABLE "Channel" ALTER COLUMN "spaceId" DROP NOT NULL;

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "dmStudentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Channel_dmStudentId_key" ON "Channel" ("dmStudentId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Channel" ADD CONSTRAINT "Channel_dmStudentId_fkey"
        FOREIGN KEY ("dmStudentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
