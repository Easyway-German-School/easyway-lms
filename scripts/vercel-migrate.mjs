import { spawnSync } from "node:child_process";

// Vercel must apply Prisma migrations before exposing a build that expects them.
// Local builds stay read-only so a developer without production credentials can
// still build and test the application.
if (!process.env.VERCEL) {
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  const isVerifiedMainBuild =
    process.env.VERCEL_GIT_PROVIDER === "github" &&
    process.env.VERCEL_GIT_REPO_OWNER === "Easyway-German-School" &&
    process.env.VERCEL_GIT_REPO_SLUG === "easyway-lms" &&
    process.env.VERCEL_GIT_COMMIT_REF === "main" &&
    /^[0-9a-f]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "");

  if (!isVerifiedMainBuild) {
    console.error(
      "Refusing a production build without verified GitHub main-branch provenance. " +
        "Deploy production from Easyway-German-School/easyway-lms@main.",
    );
    process.exit(1);
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const deployArgs = ["--prefix", "prototype", "run", "db:migrate"];

function runMigrate(args) {
  const result = spawnSync(npm, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    console.error("Could not start Prisma migration command:", result.error.message);
    return { status: 1, output: "" };
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

let result = runMigrate(deployArgs);
const failedReferralMigration = "20261008120000_student_referrals";

if (
  result.status !== 0 &&
  result.output.includes("P3009") &&
  result.output.includes(failedReferralMigration)
) {
  console.warn(
    `Resolving the known failed migration ${failedReferralMigration} as rolled back before retrying its idempotent migration with legacy referral tables preserved.`,
  );
  const resolve = spawnSync(
    npm,
    [
      "--prefix",
      "prototype",
      "exec",
      "--",
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      failedReferralMigration,
      "--schema=./prisma/schema.prisma",
    ],
    { stdio: "inherit", env: process.env },
  );

  if (resolve.error) {
    console.error("Could not resolve the known failed referral migration:", resolve.error.message);
    process.exit(1);
  }
  if (resolve.status !== 0) {
    console.error("Prisma could not mark the known failed referral migration as rolled back.");
    process.exit(resolve.status ?? 1);
  }

  result = runMigrate(deployArgs);
}

process.exit(result.status);
