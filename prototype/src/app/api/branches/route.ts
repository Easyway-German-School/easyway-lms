import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const fallbackBranches = [
  { name: "Lagos", location: "Lagos", status: "active" },
  { name: "Abuja", location: "Abuja", status: "active" },
  { name: "Port Harcourt", location: "Port Harcourt", status: "active" },
] as const;

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

export async function GET() {
  try {
    const hasBranchTable = await branchTableExists();
    if (!hasBranchTable) {
      return NextResponse.json({ branches: fallbackBranches.map((branch) => ({ id: branch.name.toLowerCase().replace(/\s+/g, "-"), ...branch })) });
    }

    const branches = await prisma.branch.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        status: true,
      },
    });

    if (branches.length > 0) {
      return NextResponse.json({ branches });
    }

    for (const branch of fallbackBranches) {
      await prisma.branch.upsert({
        where: { name: branch.name },
        update: {
          location: branch.location,
          status: branch.status,
        },
        create: {
          name: branch.name,
          location: branch.location,
          status: branch.status,
        },
      });
    }

    const seededBranches = await prisma.branch.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        status: true,
      },
    });

    return NextResponse.json({ branches: seededBranches });
  } catch (error) {
    console.error("Failed to load branches", error);
    return NextResponse.json({ branches: fallbackBranches.map((branch) => ({ id: branch.name.toLowerCase().replace(/\s+/g, "-"), ...branch })) });
  }
}
