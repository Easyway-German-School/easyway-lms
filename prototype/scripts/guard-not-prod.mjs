// Refuse to run a destructive command against the PRODUCTION database.
//
// Why this exists: on 2026-09-03 the live Neon database was reset to an empty
// schema by a `prisma` command run from a local checkout whose .env still
// pointed at production. Local/worktree .env files now point at the `dev` Neon
// branch; this is the backstop for when one gets hand-edited back, copied from
// an old backup, or a fresh clone is set up wrong.
//
// Wired into: predev, db:push, db:reset (see package.json). NOT db:migrate
// (`prisma migrate deploy`) — Vercel's production build runs that legitimately,
// and it only applies pending migrations, never drops/resets.

import fs from "node:fs";
import path from "node:path";

// Every Neon endpoint that fronts the production branch (br-flat-king-asizvykx).
// If prod is ever rebranched/rotated, add the new endpoint id here too.
const PROD_HOSTS = ["ep-green-king-as4m5c1h"];

// Vercel's own build IS allowed to reach prod (that is where migrations apply).
if (process.env.VERCEL) {
  process.exit(0);
}

/** Pull DATABASE_URL / DIRECT_DATABASE_URL out of a dotenv file. */
function urlsFromEnvFile(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(DATABASE_URL|DIRECT_DATABASE_URL)\s*=\s*(.+)\s*$/);
    if (m) out.push(m[2].trim().replace(/^["']|["']$/g, ""));
  }
  return out;
}

const cwd = process.cwd();
const candidates = [
  process.env.DATABASE_URL,
  process.env.DIRECT_DATABASE_URL,
  ...urlsFromEnvFile(path.join(cwd, ".env")),
  ...urlsFromEnvFile(path.join(cwd, ".env.local")),
].filter(Boolean);

const hit = candidates.find((u) => PROD_HOSTS.some((h) => u.includes(h)));

if (hit) {
  console.error("\n  ⛔  BLOCKED — a database URL in scope points at PRODUCTION.\n");
  console.error("  Destructive commands must run against the 'dev' Neon branch, never prod.");
  console.error("  Fix prototype/.env and prototype/.env.local, then retry:\n");
  console.error("    npx neonctl connection-string dev --project-id icy-resonance-04615932 \\");
  console.error("      --database-name neondb --pooled\n");
  console.error("  (Direct URL: drop the --pooled flag.)\n");
  process.exit(1);
}

console.log("guard-not-prod: no production database URL in scope — proceeding.");
