import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { assessBackupHealth } from "@/lib/backup-health";

/** Backup health plus the recent run history, for the security screen. */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const [statuses, recent] = await Promise.all([
    assessBackupHealth(),
    prisma.backupRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
  ]);

  return NextResponse.json({
    statuses,
    // BigInt does not survive JSON.stringify, and sizeBytes is one.
    recent: recent.map((run) => ({
      ...run,
      sizeBytes: run.sizeBytes != null ? Number(run.sizeBytes) : null,
    })),
  });
}
