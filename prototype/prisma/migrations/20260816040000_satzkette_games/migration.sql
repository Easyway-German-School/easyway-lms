-- Satzkette — the story a class writes one sentence at a time.
--
-- Three new tables and nothing else. No column is added to an existing table,
-- no index is dropped, no row is touched. Nothing in the currently deployed
-- code reads these tables, so applying this early breaks nothing and applying
-- it late loses nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- GameMatch — one story, belonging to one cohort
-- ---------------------------------------------------------------------------
--
-- `spaceId` is nullable so a match can exist without a cohort behind it: a
-- private student has no Space, and their games are scoped by their own roster
-- instead. Everything else about the row is identical, which is why this is one
-- table rather than two.

CREATE TABLE IF NOT EXISTS "GameMatch" (
  "id"          TEXT NOT NULL,
  "spaceId"     TEXT,
  "title"       TEXT NOT NULL,
  "prompt"      TEXT,
  "createdById" TEXT,
  -- active | completed | archived
  "status"      TEXT NOT NULL DEFAULT 'active',
  -- How many sentences before the story is finished. A story that could run
  -- forever never gets read back, and the moment the class scrolls the whole
  -- thing is the payoff the turns were for.
  "targetTurns" INTEGER NOT NULL DEFAULT 12,
  -- The deck of per-turn rules, COPIED off the ConstraintDeck at creation
  -- rather than referenced: a tutor editing a deck mid-story must not
  -- retroactively change what turn three was asked to do.
  "constraints" JSONB,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,

  CONSTRAINT "GameMatch_pkey" PRIMARY KEY ("id")
);

-- "What is my cohort playing right now" — the query behind the Games tab.
CREATE INDEX IF NOT EXISTS "GameMatch_spaceId_status_createdAt_idx"
  ON "GameMatch" ("spaceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GameMatch_tenantId_idx" ON "GameMatch" ("tenantId");

-- CASCADE from Space: a cohort's Space going away takes its games with it,
-- because a story scoped to a class that no longer exists is unreachable by
-- construction. SET NULL from User: a tutor leaving must not delete the
-- stories their classes wrote.
DO $$ BEGIN
  ALTER TABLE "GameMatch" ADD CONSTRAINT "GameMatch_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameMatch" ADD CONSTRAINT "GameMatch_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameMatch" ADD CONSTRAINT "GameMatch_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- GameTurn — one sentence, offered to one student
-- ---------------------------------------------------------------------------
--
-- THE ASSIGNED/PLAYED SPLIT IS THE WHOLE DESIGN. A turn is offered to a named
-- student, because "it is your turn" aimed at a person is the entire reason
-- anybody comes back to the app. But a turn only that student can play stalls
-- the story the first time somebody is ill, and a chain that dies at student
-- three teaches nobody anything.
--
-- So the deadline does not skip the turn, it OPENS it: past `deadline` anyone
-- in the cohort may take it. `assignedToId` is who was asked and never changes;
-- `playerId` is who actually wrote it and is null until somebody does.

CREATE TABLE IF NOT EXISTS "GameTurn" (
  "id"           TEXT NOT NULL,
  "matchId"      TEXT NOT NULL,
  "assignedToId" TEXT NOT NULL,
  "playerId"     TEXT,
  "position"     INTEGER NOT NULL,
  -- pending | open | submitted. Stored rather than derived from `deadline`
  -- because "open" is a thing the cohort gets notified about, and a state
  -- nobody can observe cannot be announced.
  "status"       TEXT NOT NULL DEFAULT 'pending',
  -- {rule:"vocab",words:[...]} | {rule:"pattern",...} | {rule:"grammar",...}
  "constraint"   JSONB,
  "sentence"     TEXT,
  "submittedAt"  TIMESTAMP(3),
  -- When this turn stops being exclusive to the assignee.
  "deadline"     TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"     TEXT,

  CONSTRAINT "GameTurn_pkey" PRIMARY KEY ("id")
);

-- One turn per position per story, so a double submission is refused by the
-- database rather than by a check that could race.
CREATE UNIQUE INDEX IF NOT EXISTS "GameTurn_matchId_position_key"
  ON "GameTurn" ("matchId", "position");
-- "What am I being waited on for" — the Games tab badge.
CREATE INDEX IF NOT EXISTS "GameTurn_assignedToId_status_idx"
  ON "GameTurn" ("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "GameTurn_playerId_idx" ON "GameTurn" ("playerId");
-- Finding turns whose deadline has passed, for the opener job.
CREATE INDEX IF NOT EXISTS "GameTurn_status_deadline_idx"
  ON "GameTurn" ("status", "deadline");
CREATE INDEX IF NOT EXISTS "GameTurn_tenantId_idx" ON "GameTurn" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "GameTurn" ADD CONSTRAINT "GameTurn_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "GameMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameTurn" ADD CONSTRAINT "GameTurn_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SET NULL rather than CASCADE: a student leaving the school must not delete
-- the sentences they contributed, or every story they touched develops a hole
-- and stops making sense to the class that wrote it.
DO $$ BEGIN
  ALTER TABLE "GameTurn" ADD CONSTRAINT "GameTurn_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GameTurn" ADD CONSTRAINT "GameTurn_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- ConstraintDeck — the rules a tutor can draw turns from
-- ---------------------------------------------------------------------------
--
-- `constraints` is JSON rather than a table of rows because the shape differs
-- per rule type — a vocab rule carries a word list, a grammar rule carries only
-- a label — and new rule types should not need a migration to add.

CREATE TABLE IF NOT EXISTS "ConstraintDeck" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "constraints" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,

  CONSTRAINT "ConstraintDeck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConstraintDeck_tenantId_idx" ON "ConstraintDeck" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "ConstraintDeck" ADD CONSTRAINT "ConstraintDeck_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConstraintDeck" ADD CONSTRAINT "ConstraintDeck_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
