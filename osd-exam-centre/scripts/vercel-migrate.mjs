import { spawnSync } from "node:child_process";

// Vercel must apply Prisma migrations before exposing a build that expects
// them. Local builds stay read-only — a developer without production
// database credentials should still be able to `npm run build` without it
// trying (and failing) to reach a real database. Mirrors the EasyWay LMS's
// own scripts/vercel-migrate.mjs for the same reason.
if (!process.env.VERCEL) {
  process.exit(0);
}

// `npm run db:migrate` calls `prisma migrate deploy` through the
// package.json script, matching the pattern the EasyWay LMS's own
// scripts/vercel-migrate.mjs already runs in production. `shell: true` is
// required on Windows for spawnSync to run a .cmd file at all (a documented
// Node.js constraint, not a workaround) — without it this errors with EINVAL
// before ever reaching Prisma. Harmless on Vercel's Linux runtime, where it
// just runs the command through /bin/sh.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "db:migrate"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

if (result.error) {
  console.error("Could not start Prisma migration deployment:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
