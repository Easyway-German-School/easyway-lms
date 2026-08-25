-- =============================================================================
-- A read-only Postgres role for the GitHub Actions backup jobs.
--
-- WHY THIS EXISTS
--
-- backup-database.yml and restore-drill.yml both need a DIRECT_DATABASE_URL
-- secret. Today that's almost certainly the app's own connection string
-- (neondb_owner), which can write, alter, and drop anything. The GitHub
-- Actions secret store is a SEPARATE system from Vercel's env vars by
-- design — see the header of backup-database.yml — specifically so a
-- compromise of one account doesn't hand over the other. Reusing the
-- full-access string as the GitHub secret quietly throws that design away:
-- whoever gets that secret gets full read/write on every student's record,
-- not just a copy of it.
--
-- pg_dump and the drill's row-count comparison only ever SELECT. This role
-- can only ever SELECT. A leaked backup credential can leak data — which a
-- backup fundamentally can always do — but it can no longer delete a table,
-- alter a grade, or forge a payment.
--
-- HOW TO RUN THIS
--
-- Connect as the role that owns the schema (neondb_owner) using the DIRECT
-- connection string, then run this file:
--
--   psql "$DIRECT_DATABASE_URL" -f scripts/create-backup-role.sql
--
-- If Neon refuses CREATE ROLE (some plans restrict it from a plain SQL
-- connection), create the role from the Neon console instead — Project →
-- Roles → New Role — then skip straight to the GRANT block below, run from
-- the console's own SQL editor.
-- =============================================================================

-- Pick a real password before running this — psql will not prompt for one.
-- Generate one with: openssl rand -base64 32
CREATE ROLE easyway_backup WITH LOGIN PASSWORD 'REPLACE_ME_BEFORE_RUNNING' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE neondb TO easyway_backup;
GRANT USAGE ON SCHEMA public TO easyway_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO easyway_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO easyway_backup;

-- Tables created by a FUTURE `prisma migrate deploy` are invisible to this
-- role until this line exists — Postgres does not grant retroactively.
-- neondb_owner is who Prisma migrations actually run as (confirmed against
-- the live DIRECT_DATABASE_URL), so privileges granted BY that role are the
-- ones that apply to what it creates next.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO easyway_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO easyway_backup;

-- =============================================================================
-- AFTER RUNNING THIS
--
-- 1. Build the connection string with the SAME host/port/database as
--    DIRECT_DATABASE_URL today, swapping only the user and password:
--      postgresql://easyway_backup:<password>@<same-host>/<same-db>?sslmode=require
--
-- 2. Set that as the GitHub repository secret DIRECT_DATABASE_URL —
--    Settings → Secrets and variables → Actions. This does NOT touch the
--    Vercel env var of the same name; the two are unrelated stores and the
--    app keeps using neondb_owner exactly as it does now.
--
-- 3. Save the password in the password manager next to the other backup
--    secrets (docs/SECURITY.md §3.1).
--
-- 4. Trigger `Backup database` and `Restore drill` by hand once each
--    (Actions tab → Run workflow) to confirm the new role can actually do
--    what it needs before trusting the nightly schedule.
-- =============================================================================
