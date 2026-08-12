-- The live quiz game — the classroom's Kahoot.
--
-- Three new tables and nothing else. No column is added to an existing table,
-- no index is dropped, no data is touched. That matters here more than usual:
-- the migration immediately before this one carries the whole community across
-- from Thread/Comment to Message and must be run inside a coordinated window
-- with a deploy, whereas this one is inert. Nothing in the currently deployed
-- code reads these tables, so applying it early breaks nothing and applying it
-- late loses nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- QuizGame — one game, with its questions frozen into it
-- ---------------------------------------------------------------------------
--
-- `questions` is a COPY of the source quiz rather than a reference to it. A
-- tutor fixing a typo in the assignment halfway through a lesson must not
-- change what a question was worth after half the class has answered it, and a
-- game re-read in March must still show the paper that was actually played.

CREATE TABLE IF NOT EXISTS "QuizGame" (
  "id"                 TEXT NOT NULL,
  -- Six digits, unlike the six letters a live class join code uses: digits open
  -- a phone's numeric keypad, and this is typed in a hurry against a countdown.
  "pin"                TEXT NOT NULL,
  "assignmentId"       TEXT,
  "questions"          JSONB NOT NULL,
  "lecturerId"         TEXT,
  "hostUserId"         TEXT NOT NULL,
  "branchId"           TEXT,
  "level"              TEXT,
  "sessionSlot"        TEXT,
  "liveSessionId"      TEXT,
  "title"              TEXT NOT NULL,
  -- lobby | question | reveal | standings | ended
  "phase"              TEXT NOT NULL DEFAULT 'lobby',
  "currentIndex"       INTEGER NOT NULL DEFAULT -1,
  -- The clock. Every response time is measured from questionStartedAt, and
  -- questionEndsAt is the only thing that decides whether an answer was in
  -- time. Both are read server-side; no client is believed about either.
  "questionStartedAt"  TIMESTAMP(3),
  "questionEndsAt"     TIMESTAMP(3),
  "secondsPerQuestion" INTEGER NOT NULL DEFAULT 20,
  "speedBonus"         BOOLEAN NOT NULL DEFAULT true,
  "shuffled"           BOOLEAN NOT NULL DEFAULT false,
  "startedAt"          TIMESTAMP(3),
  "endedAt"            TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"           TEXT,

  CONSTRAINT "QuizGame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuizGame_pin_key" ON "QuizGame" ("pin");
CREATE INDEX IF NOT EXISTS "QuizGame_pin_idx" ON "QuizGame" ("pin");
-- The one-tap join query: "is my own cohort playing something right now?"
CREATE INDEX IF NOT EXISTS "QuizGame_branchId_level_sessionSlot_endedAt_idx"
  ON "QuizGame" ("branchId", "level", "sessionSlot", "endedAt");
CREATE INDEX IF NOT EXISTS "QuizGame_lecturerId_createdAt_idx"
  ON "QuizGame" ("lecturerId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuizGame_tenantId_idx" ON "QuizGame" ("tenantId");

-- SET NULL throughout: deleting a quiz, a tutor, a branch or a video session
-- must not delete the record of a lesson that happened. The game keeps its own
-- copy of everything it needs to be read back.
DO $$ BEGIN
  ALTER TABLE "QuizGame" ADD CONSTRAINT "QuizGame_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGame" ADD CONSTRAINT "QuizGame_lecturerId_fkey"
    FOREIGN KEY ("lecturerId") REFERENCES "Lecturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGame" ADD CONSTRAINT "QuizGame_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGame" ADD CONSTRAINT "QuizGame_liveSessionId_fkey"
    FOREIGN KEY ("liveSessionId") REFERENCES "LiveClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGame" ADD CONSTRAINT "QuizGame_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- QuizGamePlayer — one student in one game
-- ---------------------------------------------------------------------------
--
-- No nickname column, deliberately. The joke names are most of the charm of the
-- product this copies and exactly what makes it useless as a school record: a
-- leaderboard of pseudonyms tells a tutor nothing about who is struggling, and
-- in a room of teenagers a free-text box is a moderation problem waiting for a
-- parent to see the projector.

CREATE TABLE IF NOT EXISTS "QuizGamePlayer" (
  "id"         TEXT NOT NULL,
  "gameId"     TEXT NOT NULL,
  "studentId"  TEXT NOT NULL,
  "score"      INTEGER NOT NULL DEFAULT 0,
  "streak"     INTEGER NOT NULL DEFAULT 0,
  "bestStreak" INTEGER NOT NULL DEFAULT 0,
  "correct"    INTEGER NOT NULL DEFAULT 0,
  "answered"   INTEGER NOT NULL DEFAULT 0,
  "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"   TEXT,

  CONSTRAINT "QuizGamePlayer_pkey" PRIMARY KEY ("id")
);

-- One row per student per game, so rejoining after a dropped connection finds
-- the score where it was left rather than starting again.
CREATE UNIQUE INDEX IF NOT EXISTS "QuizGamePlayer_gameId_studentId_key"
  ON "QuizGamePlayer" ("gameId", "studentId");
CREATE INDEX IF NOT EXISTS "QuizGamePlayer_gameId_score_idx"
  ON "QuizGamePlayer" ("gameId", "score");
CREATE INDEX IF NOT EXISTS "QuizGamePlayer_tenantId_idx" ON "QuizGamePlayer" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "QuizGamePlayer" ADD CONSTRAINT "QuizGamePlayer_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "QuizGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGamePlayer" ADD CONSTRAINT "QuizGamePlayer_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGamePlayer" ADD CONSTRAINT "QuizGamePlayer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- QuizGameAnswer — one answer to one question
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "QuizGameAnswer" (
  "id"            TEXT NOT NULL,
  "gameId"        TEXT NOT NULL,
  "playerId"      TEXT NOT NULL,
  "questionIndex" INTEGER NOT NULL,
  "answer"        JSONB,
  "correct"       BOOLEAN NOT NULL DEFAULT false,
  -- 0..1 — a checkbox question can be part right.
  "credit"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "points"        INTEGER NOT NULL DEFAULT 0,
  -- Measured from QuizGame.questionStartedAt on the server, never sent by a
  -- client. It is the sole input to the speed bonus, which is to say it decides
  -- who wins, which is why it is not a number any browser is allowed to supply.
  "msTaken"       INTEGER NOT NULL,
  "answeredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"      TEXT,

  CONSTRAINT "QuizGameAnswer_pkey" PRIMARY KEY ("id")
);

-- THE ANTI-CHEAT. A second submission for a question already answered is
-- refused by the database rather than by a check in application code that
-- thirty phones on one wifi would race straight past.
CREATE UNIQUE INDEX IF NOT EXISTS "QuizGameAnswer_playerId_questionIndex_key"
  ON "QuizGameAnswer" ("playerId", "questionIndex");
CREATE INDEX IF NOT EXISTS "QuizGameAnswer_gameId_questionIndex_idx"
  ON "QuizGameAnswer" ("gameId", "questionIndex");
CREATE INDEX IF NOT EXISTS "QuizGameAnswer_tenantId_idx" ON "QuizGameAnswer" ("tenantId");

DO $$ BEGIN
  ALTER TABLE "QuizGameAnswer" ADD CONSTRAINT "QuizGameAnswer_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "QuizGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGameAnswer" ADD CONSTRAINT "QuizGameAnswer_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "QuizGamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QuizGameAnswer" ADD CONSTRAINT "QuizGameAnswer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
