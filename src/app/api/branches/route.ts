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

function withFallbackIds() {
  return fallbackBranches.map((branch) => ({
    id: branch.name.toLowerCase().replace(/\s+/g, "-"),
    ...branch,
  }));
}

async function branchTableExists() {
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Branch'
    `;
    return rows.some((row) => row.name === "Branch");
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
