import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { assessBackupHealth } from "@/lib/backup-health";
import { guardedPrisma, prisma } from "@/lib/prisma";
import { snapshotAll } from "@/lib/resilience";
// Breakers and bulkheads register themselves when their module loads. Importing
// these for their side effect makes sure the ones that matter exist in this
// instance before we ask what state they are in.
import "@/lib/incidents";
import "@/lib/capture-error";
import "@/lib/guarded-fetch";

export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

/**
 * The vital signs the developer console polls: is the database answering and how
 * fast, what is broken right now, whether students' screens agree with the
 * database, and whether the backups are running.
 *
 * Deliberately cheap — a handful of indexed counts — because it is polled every
 * ten seconds by whoever has the console open, on the same database the school
 * is using. Behind `security` (super admin only) like the rest of the console:
 * incident samples carry student ids and error detail.
 */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const now = Date.now();
  const hourAgo = new Date(now - HOUR);
  const dayAgo = new Date(now - 24 * HOUR);

  // Timed on its own: this is the number that says "the database is slow", and
  // it must not include the time the other queries below take.
  const startedAt = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Math.round(performance.now() - startedAt);

  const [active, students, byVerdict, witnessed24h, showingLockWhileOpen, backups] = await Promise.all([
    guardedPrisma.incident.findMany({
      where: { status: { in: ["open", "acknowledged"] } },
      select: { kind: true, severity: true, status: true, occurrences: true, firstSeenAt: true, lastSeenAt: true, reopenedCount: true },
      take: 1000,
    }),
    prisma.student.count(),
    prisma.accessSnapshot.groupBy({ by: ["verdictKey"], _count: { _all: true } }),
    prisma.accessSnapshot.count({ where: { lastWitnessAt: { gt: dayAgo } } }),
    // A screen that last reported a lock while the database says the portal is open.
    prisma.accessSnapshot.count({ where: { open: true, lastWitnessRendered: { in: ["payment", "batch", "photo"] } } }),
    assessBackupHealth().catch(() => []),
  ]);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  let openNow = 0;
  let regressions = 0;
  let driftOpen = 0;
  let occurrences = 0;
  let newLastHour = 0;
  let activeLastHour = 0;
  for (const incident of active) {
    if (incident.status === "open") openNow++;
    bySeverity[incident.severity] = (bySeverity[incident.severity] ?? 0) + 1;
    if (incident.reopenedCount > 0 && incident.status === "open") regressions++;
    if (incident.kind === "drift") driftOpen++;
    occurrences += incident.occurrences;
    if (incident.firstSeenAt > hourAgo) newLastHour++;
    if (incident.lastSeenAt > hourAgo) activeLastHour++;
  }

  const locked = byVerdict.filter((row) => row.verdictKey !== "open");
  return NextResponse.json({
    at: new Date(now).toISOString(),
    db: { ms: dbMs },
    incidents: {
      active: active.length,
      open: openNow,
      acknowledged: active.length - openNow,
      bySeverity,
      regressions,
      driftOpen,
      newLastHour,
      activeLastHour,
      // A running total; the console diffs successive polls to draw a rate.
      occurrences,
    },
    access: {
      students,
      known: byVerdict.reduce((sum, row) => sum + row._count._all, 0),
      openCount: byVerdict.find((row) => row.verdictKey === "open")?._count._all ?? 0,
      lockedCount: locked.reduce((sum, row) => sum + row._count._all, 0),
      byVerdict: byVerdict
        .map((row) => ({ key: row.verdictKey, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      witnessed24h,
      showingLockWhileOpen,
    },
    // The breakers and bulkheads of THIS server instance only — each warm serverless
    // instance keeps its own, so these numbers are a sample, not a fleet total.
    resilience: snapshotAll(),
    backups: backups.map((b) => ({ kind: b.kind, label: b.label, state: b.state, hoursSinceSuccess: b.hoursSinceSuccess })),
  });
}
