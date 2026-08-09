-- Per-person notification preferences.
--
-- Additive and empty on arrival. Delivery is unchanged for everybody until
-- somebody opens their settings and unticks something: `mutedChannelsFor`
-- treats a missing row as "no objection", which is exactly what every existing
-- account has. No backfill is needed or wanted.
--
-- ON DELETE CASCADE because a preference has no meaning without the person.
-- Note that User rows are soft-deleted (see prisma-guard.ts), so this fires
-- only on a genuine hard delete.

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "inApp"     BOOLEAN NOT NULL DEFAULT true,
    "push"      BOOLEAN NOT NULL DEFAULT true,
    "email"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- One row per person per kind. This is the upsert target, so it is a
-- correctness constraint rather than an optimisation: without it a settings
-- page saved twice would leave two contradictory rows and the loser would
-- silently win on some future read.
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_kind_key"
    ON "NotificationPreference"("userId", "kind");

-- notify() loads every preference for a batch of recipients at once.
CREATE INDEX IF NOT EXISTS "NotificationPreference_userId_idx"
    ON "NotificationPreference"("userId");

DO $$
BEGIN
    ALTER TABLE "NotificationPreference"
        ADD CONSTRAINT "NotificationPreference_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
