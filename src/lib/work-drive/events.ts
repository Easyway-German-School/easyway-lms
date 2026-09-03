/**
 * Staff-calendar rules: which events an admin sees, whether they may edit one,
 * and how a recurring event expands into occurrences.
 *
 * Recurrence is a deliberate SUBSET of RFC 5545 — FREQ (DAILY/WEEKLY/MONTHLY),
 * INTERVAL, and one of COUNT or UNTIL. That covers "every Monday", "first of
 * the month", "every two weeks for ten weeks", which is the whole of what a
 * school calendar needs. A full RRULE engine (the `rrule` package) is the swap
 * if BYDAY lists or exceptions ever come up — see docs/WORK_DRIVE.md.
 */

import { Prisma } from "@prisma/client";
import type { AdminContext } from "@/lib/admin-roles";

export const EVENT_KINDS = ["meeting", "deadline", "holiday", "training", "event", "webinar"] as const;
export const EVENT_VISIBILITIES = ["workspace", "staff", "branch", "public"] as const;
export const EVENT_STATUSES = ["draft", "scheduled", "live", "ended", "cancelled"] as const;

export function normalizeEventKind(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (EVENT_KINDS as readonly string[]).includes(s) ? s : "meeting";
}
export function normalizeEventVisibility(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (EVENT_VISIBILITIES as readonly string[]).includes(s) ? s : "staff";
}
export function normalizeEventStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (EVENT_STATUSES as readonly string[]).includes(s) ? s : "scheduled";
}

/**
 * The events this admin may see. `staff` events for anyone; `branch` events for
 * an admin scoped to that branch (or any unrestricted admin); `workspace`
 * events only alongside membership; `public` events for anyone (they have a
 * landing page anyway). A `createdById` match always wins.
 */
export function visibleEventsWhere(
  admin: Pick<AdminContext, "userId" | "branchIds">,
): Prisma.WorkEventWhereInput {
  if (admin.branchIds === null) return {}; // unrestricted admin sees all

  const or: Prisma.WorkEventWhereInput[] = [
    { visibility: "staff" },
    { visibility: "public" },
    { createdById: admin.userId },
    { workspace: { members: { some: { userId: admin.userId } } } },
  ];
  if ((admin.branchIds ?? []).length > 0) {
    or.push({ visibility: "branch", branchId: { in: admin.branchIds as string[] } });
  }
  return { OR: or };
}

export function canEditEvent(
  event: { createdById: string | null; workspace: { members: { userId: string; role: string }[] } | null },
  admin: Pick<AdminContext, "userId" | "branchIds">,
): boolean {
  if (admin.branchIds === null) return true;
  if (event.createdById === admin.userId) return true;
  const m = event.workspace?.members.find((x) => x.userId === admin.userId);
  return m?.role === "owner" || m?.role === "editor";
}

type ParsedRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  count: number | null;
  until: Date | null;
};

/** Parse the RRULE subset. Returns null for "no recurrence" or anything odd. */
export function parseRule(rrule: string | null | undefined): ParsedRule | null {
  if (!rrule) return null;
  const parts = new Map<string, string>();
  for (const seg of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = seg.split("=");
    if (k && v) parts.set(k.trim().toUpperCase(), v.trim());
  }
  const freq = parts.get("FREQ")?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  const interval = Math.max(1, parseInt(parts.get("INTERVAL") || "1", 10) || 1);
  const count = parts.has("COUNT") ? Math.max(1, parseInt(parts.get("COUNT")!, 10) || 1) : null;
  let until: Date | null = null;
  if (parts.has("UNTIL")) {
    const raw = parts.get("UNTIL")!.replace(/[TZ]/g, (m) => (m === "T" ? "T" : "Z"));
    const d = new Date(raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw);
    until = isNaN(d.getTime()) ? null : d;
  }
  return { freq, interval, count, until };
}

export function addStepPublic(d: Date, rule: ParsedRule): Date {
  return addStep(d, rule);
}

function addStep(d: Date, rule: ParsedRule): Date {
  const n = new Date(d);
  if (rule.freq === "DAILY") n.setDate(n.getDate() + rule.interval);
  else if (rule.freq === "WEEKLY") n.setDate(n.getDate() + 7 * rule.interval);
  else n.setMonth(n.getMonth() + rule.interval);
  return n;
}

export type Occurrence = { startAt: Date; endAt: Date | null };

/**
 * Every occurrence of an event that overlaps [rangeStart, rangeEnd]. A
 * non-recurring event yields itself (if it overlaps); a recurring one is
 * stepped forward from its first start, capped by COUNT/UNTIL and a hard
 * 500-iteration guard.
 */
export function expandOccurrences(
  event: { startAt: Date; endAt: Date | null; rrule: string | null },
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  const durationMs = event.endAt ? event.endAt.getTime() - event.startAt.getTime() : 0;
  const rule = parseRule(event.rrule);

  if (!rule) {
    const end = event.endAt ?? event.startAt;
    return end >= rangeStart && event.startAt <= rangeEnd
      ? [{ startAt: event.startAt, endAt: event.endAt }]
      : [];
  }

  const out: Occurrence[] = [];
  let cursor = new Date(event.startAt);
  let emitted = 0;
  for (let i = 0; i < 500; i++) {
    if (rule.count != null && emitted >= rule.count) break;
    if (rule.until && cursor > rule.until) break;
    if (cursor > rangeEnd) break;

    const occEnd = durationMs ? new Date(cursor.getTime() + durationMs) : null;
    if ((occEnd ?? cursor) >= rangeStart) {
      out.push({ startAt: new Date(cursor), endAt: occEnd });
    }
    emitted++;
    cursor = addStep(cursor, rule);
  }
  return out;
}
