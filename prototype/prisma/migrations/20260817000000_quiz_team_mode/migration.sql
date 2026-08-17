-- Team mode for the live quiz game.
--
-- Two nullable/defaulted columns on existing tables and nothing else. No table
-- is created, no index is dropped, no row is touched, and every game already in
-- the database reads as a solo game because that is what `false` and `NULL`
-- mean here. So applying this early breaks nothing and applying it late loses
-- nothing.
--
-- Written by hand and idempotent, per prisma/manual/README: this project used
-- `db push` before it used migrations, so the database may already carry parts
-- of any given change. Never run `prisma migrate dev` against this database.

-- ---------------------------------------------------------------------------
-- QuizGame.teamMode — whether this game is played in teams
-- ---------------------------------------------------------------------------
--
-- Defaulted rather than nullable: "are we in teams" has no third answer, and a
-- NULL would force every read site to decide what it meant.
ALTER TABLE "QuizGame" ADD COLUMN IF NOT EXISTS "teamMode" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- QuizGamePlayer.team — which team, when there are teams
-- ---------------------------------------------------------------------------
--
-- Nullable, and NULL is meaningful: it is a player in a solo game. A team is a
-- NAME here rather than a foreign key — a team lives for forty minutes and has
-- no existence outside its one game, so a table for it would be rows nothing
-- ever reads again. The permitted names are fixed in src/lib/live-quiz.ts and
-- validated on join.
ALTER TABLE "QuizGamePlayer" ADD COLUMN IF NOT EXISTS "team" TEXT;

-- Standings in a team game group by team within one game. The existing
-- [gameId, score] index does not serve that, and a team game with thirty
-- players would otherwise scan.
CREATE INDEX IF NOT EXISTS "QuizGamePlayer_gameId_team_idx" ON "QuizGamePlayer" ("gameId", "team");
