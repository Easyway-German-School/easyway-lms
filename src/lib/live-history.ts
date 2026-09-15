import { prisma } from "@/lib/prisma";
import { SLOT_DEFAULTS, normalizeSlot } from "@/lib/class-times";
import { dayKey } from "@/lib/class-sessions";
import { SCHOOL_TIMEZONE, zonedDateKey, zonedTimeToInstant } from "@/lib/school-time";

/**
 * "Did this tutor start on time?" — a past-session read of `LiveClassSession`,
 * which has carried `startedAt`/`endedAt` since the live-presence feature
 * shipped (see lib/live-presence.ts) but had nowhere on the admin side to be
 * seen once the class ended. `/admin/live` only ever showed rooms live RIGHT
 * NOW; this is its history.
 *
 * "Scheduled start" isn't stored on the session — it's derived the same way
 * the student calendar derives it: the slot's default clock time
 * (`SLOT_DEFAULTS`), overridden by a tutor's own `ClassSession.startTime` for
 * that exact day, if they set one. Only meaningful for a cohort class with a
 * branch/level/slot to look up; a private one-to-one has its own booked time
 * on `PrivateClass`, not this table, so `lateMinutes` is null for those.
 */

export type LiveHistoryRow = {
  id: string;
  roomName: string;
  title: string;
  kind: string;
  branchId: string | null;
  branchName: string | null;
  level: string | null;
  sessionSlot: string | null;
  lecturerId: string | null;
  lecturerName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  /** The clock time the class was due to start, in school time. Null when there's nothing to compare against. */
  scheduledAt: string | null;
  /** Actual minus scheduled, in minutes. Negative = started early. Null when scheduledAt is null. */
  lateMinutes: number | null;
};

export async function listLiveClassHistory(args: {
  branchId?: string | null;
  lecturerId?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  from?: Date | null;
  to?: Date | null;
  take?: number;
  skip?: number;
}): Promise<{ rows: LiveHistoryRow[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (args.branchId) where.branchId = args.branchId;
  if (args.lecturerId) where.lecturerId = args.lecturerId;
  if (args.level) where.level = args.level.toUpperCase();
  if (args.sessionSlot) where.sessionSlot = normalizeSlot(args.sessionSlot);
  if (args.from || args.to) {
    const startedAt: Record<string, Date> = {};
    if (args.from) startedAt.gte = args.from;
    if (args.to) startedAt.lte = args.to;
    where.startedAt = startedAt;
  }

  const take = Math.min(Math.max(args.take ?? 50, 1), 200);
  const skip = Math.max(args.skip ?? 0, 0);

  const [sessions, total] = await Promise.all([
    prisma.liveClassSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take,
      skip,
      include: {
        branch: { select: { name: true } },
        lecturer: { select: { id: true, user: { select: { name: true } } } },
      },
    }),
    prisma.liveClassSession.count({ where }),
  ]);

  // One batched lookup for every ClassSession row a cohort session in this page
  // could match, rather than a query per row — this is a list, not a detail page.
  const cohortRows = sessions.filter((s) => s.kind === "cohort" && s.branchId && s.level && s.sessionSlot);
  const lookups = cohortRows.map((s) => ({
    branchId: s.branchId as string,
    level: s.level as string,
    timeSlot: normalizeSlot(s.sessionSlot),
    date: dayKey(s.startedAt),
  }));

  const overrides = lookups.length
    ? await prisma.classSession.findMany({
        where: { OR: lookups.map((k) => ({ branchId: k.branchId, level: k.level, timeSlot: k.timeSlot, date: k.date })) },
        select: { branchId: true, level: true, timeSlot: true, date: true, startTime: true },
      })
    : [];
  const overrideStart = new Map<string, string>();
  for (const o of overrides) {
    if (!o.startTime) continue;
    overrideStart.set(`${o.branchId}:${o.level}:${o.timeSlot}:${o.date.toISOString()}`, o.startTime);
  }

  const rows: LiveHistoryRow[] = sessions.map((s) => {
    let scheduledAt: Date | null = null;
    if (s.kind === "cohort" && s.branchId && s.level && s.sessionSlot) {
      const slot = normalizeSlot(s.sessionSlot);
      const day = dayKey(s.startedAt);
      const key = `${s.branchId}:${s.level}:${slot}:${day.toISOString()}`;
      const clock = overrideStart.get(key) ?? SLOT_DEFAULTS[slot].startTime;
      scheduledAt = zonedTimeToInstant(zonedDateKey(s.startedAt, SCHOOL_TIMEZONE), clock, SCHOOL_TIMEZONE);
    }

    return {
      id: s.id,
      roomName: s.roomName,
      title: s.title,
      kind: s.kind,
      branchId: s.branchId,
      branchName: s.branch?.name ?? null,
      level: s.level,
      sessionSlot: s.sessionSlot,
      lecturerId: s.lecturerId,
      lecturerName: s.lecturer?.user?.name ?? null,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      durationMinutes: s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000) : null,
      scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
      lateMinutes: scheduledAt ? Math.round((s.startedAt.getTime() - scheduledAt.getTime()) / 60_000) : null,
    };
  });

  return { rows, total };
}
