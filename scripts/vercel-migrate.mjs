import { spawnSync } from "node:child_process";

// Vercel must apply Prisma migrations before exposing a build that expects them.
// Local builds stay read-only so a developer without production credentials can
// still build and test the application.
if (!process.env.VERCEL) {
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["--prefix", "prototype", "run", "db:migrate"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Could not start Prisma migration deployment:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
