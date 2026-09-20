import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import type { BackendGraph } from "@/lib/backend-graph";
import { guardedPrisma } from "@/lib/prisma";
import graphJson from "@/generated/backend-graph.json";

export const dynamic = "force-dynamic";

/**
 * The backend map, plus which parts of it are on fire.
 *
 * Two responses from one route so the heavy one can be cached and the light one
 * polled:
 *   default        the static map (generated from the source at build time).
 *   ?part=overlay  open incidents grouped by route, keyed by the same
 *                  `/api/...` pattern the map's route nodes use — Next reports
 *                  `routePath` in that shape, so an incident lands on its node
 *                  with no translation.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  if (new URL(request.url).searchParams.get("part") !== "overlay") {
    return NextResponse.json(graphJson as unknown as BackendGraph, {
      // The map only changes when the code does; 10 minutes is plenty.
      headers: { "Cache-Control": "private, max-age=600" },
    });
  }

  const rows = await guardedPrisma.incident.findMany({
    where: { status: { in: ["open", "acknowledged"] }, route: { not: null } },
    select: { route: true, severity: true, occurrences: true, kind: true },
    take: 1000,
  });
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const overlay: Record<string, { incidents: number; occurrences: number; worst: string; drift: boolean }> = {};
  for (const row of rows) {
    const key = row.route!;
    const entry = (overlay[key] ??= { incidents: 0, occurrences: 0, worst: "low", drift: false });
    entry.incidents += 1;
    entry.occurrences += row.occurrences;
    if ((rank[row.severity] ?? 0) > (rank[entry.worst] ?? 0)) entry.worst = row.severity;
    if (row.kind === "drift") entry.drift = true;
  }
  return NextResponse.json({ overlay });
}
