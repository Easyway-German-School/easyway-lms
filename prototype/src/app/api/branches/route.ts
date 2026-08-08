import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ONLINE_BRANCH_NAME } from "@/lib/online-branch";

const fallbackBranches = [
  { name: "Lagos", location: "Lagos", status: "active", mode: "physical" },
  { name: "Abuja", location: "Abuja", status: "active", mode: "physical" },
  { name: "Port Harcourt", location: "Port Harcourt", status: "active", mode: "physical" },
  {
    name: ONLINE_BRANCH_NAME,
    location: "Live online — join from anywhere",
    status: "active",
    mode: "online",
  },
] as const;

const branchSelect = {
  id: true,
  name: true,
  location: true,
  status: true,
  mode: true,
} as const;

/**
 * The last-resort list, for when the database cannot be reached at all.
 *
 * These ids are slugs, not the cuids `Student.branchId` is a foreign key to,
 * so a signup submitted against this list cannot be stored against a real
 * branch. That is accepted rather than fixed: if Prisma is down there is no
 * id to offer that would be any better, and showing the school's branches
 * beats showing an empty form. It matters only that this stays a genuine
 * fallback — for a year it was the ONLY thing this route returned.
 */
function withFallbackIds() {
  return fallbackBranches.map((branch) => ({
    id: branch.name.toLowerCase().replace(/\s+/g, "-"),
    ...branch,
  }));
}

/**
 * Whether there is a Branch table to read.
 *
 * This asked `sqlite_master` until the Postgres migration, at which point the
 * query stopped returning nothing and started THROWING — the table does not
 * exist on Postgres — so the catch below returned false on every single call.
 * The consequence was not a visible failure, which is why it survived: this
 * route simply never reached the database again. It served `fallbackBranches`
 * to every caller, so
 *
 *   - the signup form offered four hardcoded branches whose ids are slugs
 *     ("lagos"), not the cuids `Student.branchId` points at;
 *   - any branch the office added, renamed or paused in /admin/branches was
 *     invisible to every one of this route's four callers;
 *   - `seedMissingBranches()` below could never run.
 *
 * Counting rows through Prisma asks the same question without naming an
 * engine.
 */
async function branchTableExists() {
  try {
    await prisma.branch.count();
    return true;
  } catch {
    return false;
  }
}

async function seedMissingBranches() {
  for (const branch of fallbackBranches) {
    await prisma.branch.upsert({
      where: { name: branch.name },
      // Only `mode` is forced on update. Location and status are left alone so
      // an admin who renamed or paused a branch by hand does not have their
      // edit silently reverted every time this route runs.
      update: { mode: branch.mode },
      create: {
        name: branch.name,
        location: branch.location,
        status: branch.status,
        mode: branch.mode,
      },
    });
  }
}

export async function GET() {
  try {
    const hasBranchTable = await branchTableExists();
    if (!hasBranchTable) {
      return NextResponse.json({ branches: withFallbackIds() });
    }

    let branches = await prisma.branch.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: branchSelect,
    });

    // The online branch is created on demand rather than requiring the seed
    // script to have been run — a fresh clone must still be able to sign an
    // online student up. Campus branches are only seeded into a truly empty
    // table, which is the pre-existing behaviour.
    const needsSeed = branches.length === 0 || !branches.some((branch) => branch.mode === "online");
    if (needsSeed) {
      await seedMissingBranches();
      branches = await prisma.branch.findMany({
        where: { status: "active" },
        orderBy: { name: "asc" },
        select: branchSelect,
      });
    }

    return NextResponse.json({ branches });
  } catch (error) {
    console.error("Failed to load branches", error);
    return NextResponse.json({ branches: withFallbackIds() });
  }
}
