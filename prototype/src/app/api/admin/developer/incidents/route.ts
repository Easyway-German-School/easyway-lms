import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { guardedPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "acknowledged", "resolved", "ignored"] as const;
const KINDS = ["error", "complaint", "drift", "health"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/**
 * The incident register, read back for the developer console.
 *
 * `?id=` returns one incident in full (stack, message, recent samples). The list
 * leaves the stack out — it is up to 4KB a row and the list is polled.
 * `?status=active` means open + acknowledged, which is what somebody looking at
 * "what is wrong right now" wants.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const incident = await guardedPrisma.incident.findUnique({ where: { id } });
    if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ incident });
  }

  const statusParam = url.searchParams.get("status");
  const status = statusParam === "active" ? { in: ["open", "acknowledged"] } : pick(statusParam, STATUSES);
  const kind = pick(url.searchParams.get("kind"), KINDS);
  const severity = pick(url.searchParams.get("severity"), SEVERITIES);
  const take = Math.min(Math.max(Number(url.searchParams.get("take")) || 60, 1), 100);
  const cursor = url.searchParams.get("cursor") || undefined;

  const rows = await guardedPrisma.incident.findMany({
    where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(severity ? { severity } : {}) },
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      kind: true,
      source: true,
      severity: true,
      status: true,
      title: true,
      route: true,
      method: true,
      occurrences: true,
      reopenedCount: true,
      samples: true,
      firstSeenAt: true,
      lastSeenAt: true,
      resolvedAt: true,
      resolutionNote: true,
    },
  });

  const hasMore = rows.length > take;
  const incidents = hasMore ? rows.slice(0, take) : rows;
  return NextResponse.json({ incidents, nextCursor: hasMore ? incidents[incidents.length - 1].id : null });
}

/**
 * Triage: acknowledge ("I have seen it"), resolve ("fixed"), ignore ("not a
 * problem"), or reopen. A resolved incident that recurs reopens itself and bumps
 * `reopenedCount` — so a resolution is a claim the system will check.
 */
export async function PATCH(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown; note?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const status = pick(typeof body.status === "string" ? body.status : null, STATUSES);
  if (!id || !status) return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  const finished = status === "resolved" || status === "ignored";
  try {
    const incident = await guardedPrisma.incident.update({
      where: { id },
      data: {
        status,
        resolvedAt: finished ? new Date() : null,
        resolvedById: finished ? (gate.session.user.id as string) : null,
        resolutionNote: finished ? note || null : null,
      },
      select: { id: true, status: true, resolvedAt: true, resolutionNote: true },
    });
    return NextResponse.json({ incident });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
