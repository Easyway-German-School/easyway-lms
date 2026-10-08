import { spawnSync } from "node:child_process";

// Vercel must apply Prisma migrations before exposing a build that expects them.
// Local builds stay read-only so a developer without production credentials can
// still build and test the application.
if (!process.env.VERCEL) {
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  const hasExpectedSource =
    process.env.VERCEL_GIT_PROVIDER === "github" &&
    process.env.VERCEL_GIT_REPO_OWNER === "Easyway-German-School" &&
    process.env.VERCEL_GIT_REPO_SLUG === "easyway-lms" &&
    process.env.VERCEL_GIT_COMMIT_REF === "main" &&
    /^[0-9a-f]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "");

  if (!hasExpectedSource) {
    console.error(
      "Refusing a production build without verified GitHub main-branch provenance. " +
        "Production must be deployed from a GitHub commit on Easyway-German-School/easyway-lms@main.",
    );
    process.exit(1);
  }
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
