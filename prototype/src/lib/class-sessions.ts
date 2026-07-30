import { prisma } from "@/lib/prisma";
import { generatePersonalizedSchedule, type ScheduleMonth } from "@/lib/schedule";

/**
 * Merges the generated timetable skeleton with the ClassSession overrides a
 * tutor has actually edited.
 *
 * The generator decides WHICH days a cohort meets (batch + level rotation).
 * This decides what those days SAY: the real topic, clock times, whether the
 * class was postponed, and which material to bring. A day with no override
 * falls back to the generated defaults, so an unedited timetable still looks
 * complete rather than empty.
 */

export const TIME_SLOTS = ["morning", "afternoon", "evening"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** House hours for each slot, used when a tutor hasn't set explicit times. */
export const SLOT_DEFAULTS: Record<TimeSlot, { startTime: string; endTime: string; label: string }> = {
  morning: { startTime: "09:00", endTime: "11:00", label: "Morning" },
  afternoon: { startTime: "13:00", endTime: "15:00", label: "Afternoon" },
  evening: { startTime: "17:00", endTime: "19:00", label: "Evening" },
};

export function normalizeSlot(value: unknown): TimeSlot {
  const v = String(value ?? "").toLowerCase();
  return (TIME_SLOTS as readonly string[]).includes(v) ? (v as TimeSlot) : "morning";
}

/**
 * The join key between the skeleton and its overrides: midnight UTC on the
 * calendar day.
 *
 * Deliberately reads LOCAL date components. The generator builds each session
 * with `new Date(year, month, day)` — local midnight — so in any timezone
 * ahead of UTC (Nigeria is UTC+1) the UTC date of that instant is the previous
 * day. Reading UTC components here would file every class against the wrong
 * date and no override would ever match.
 */
export function dayKey(date: Date | string): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export type MergedSession = {
  date: string;
  weekday: string;
  level: string;
  title: string;
  /** The generated default focus, kept so the UI can show it when no topic is set. */
  defaultFocus: string;
  slot: string;

  timeSlot: TimeSlot;
  startTime: string;
  endTime: string;
  topic: string | null;
  notes: string | null;
  status: string;
  postponedTo: string | null;
  /** True when a tutor has actually touched this day. */
  edited: boolean;
  lecturerName: string | null;
  material: { id: string; title: string; filePath: string; fileType: string } | null;
};

export type MergedMonth = Omit<ScheduleMonth, "sessions"> & { sessions: MergedSession[] };

/**
 * Build the merged timetable for one cohort.
 * `branchId` may be null for students without a branch — they still get the
 * generated skeleton, just with no overrides to apply.
 *
 * `sessionSlot` is the sitting the student actually attends. It has to be part
 * of the query: ClassSession is unique on branch + level + date + timeSlot, so
 * a branch running a morning AND an evening group of the same level has two
 * rows for the same day. Matching on date alone would hand every student
 * whichever of the two happened to be read last.
 */
export async function getMergedSchedule(args: {
  branchId: string | null;
  level: string;
  batch?: string | null;
  sessionSlot?: string | null;
  now?: Date;
  months?: number;
}): Promise<{ level: string; batchMonth: string; batchYear: number; sessionSlot: TimeSlot; months: MergedMonth[] }> {
  const slot = normalizeSlot(args.sessionSlot);

  const generated = generatePersonalizedSchedule({
    level: args.level,
    batch: args.batch ?? null,
    now: args.now,
    months: args.months ?? 2,
  });

  const allDates = generated.months.flatMap((m) => m.sessions.map((s) => dayKey(s.date)));
  if (!args.branchId || allDates.length === 0) {
    return { ...generated, sessionSlot: slot, months: generated.months.map((m) => withDefaults(m, slot)) };
  }

  const overrides = await prisma.classSession.findMany({
    where: {
      branchId: args.branchId,
      level: generated.level,
      timeSlot: slot,
      date: { in: allDates },
    },
    include: {
      lecturer: { select: { user: { select: { name: true } } } },
      material: { select: { id: true, title: true, filePath: true, fileType: true } },
    },
  });

  // Key by day so lookup during the merge is O(1).
  const byDay = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) byDay.set(o.date.toISOString(), o);

  const months = generated.months.map((month) => ({
    ...month,
    sessions: month.sessions.map((s) => {
      const override = byDay.get(dayKey(s.date).toISOString());
      // An unedited day still belongs to the student's own sitting.
      const timeSlot = normalizeSlot(override?.timeSlot ?? slot);
      const defaults = SLOT_DEFAULTS[timeSlot];

      return {
        date: s.date,
        weekday: s.weekday,
        level: s.level,
        title: s.title,
        defaultFocus: s.focus,
        slot: s.slot,
        timeSlot,
        startTime: override?.startTime || defaults.startTime,
        endTime: override?.endTime || defaults.endTime,
        topic: override?.topic ?? null,
        notes: override?.notes ?? null,
        status: override?.status ?? "scheduled",
        postponedTo: override?.postponedTo ? override.postponedTo.toISOString() : null,
        edited: Boolean(override),
        lecturerName: override?.lecturer?.user?.name ?? null,
        material: override?.material ?? null,
      } satisfies MergedSession;
    }),
  }));

  return { ...generated, sessionSlot: slot, months };
}

/** Shape an unedited month so the client only deals with one session type. */
function withDefaults(month: ScheduleMonth, slot: TimeSlot): MergedMonth {
  const defaults = SLOT_DEFAULTS[slot];
  return {
    ...month,
    sessions: month.sessions.map((s) => ({
      date: s.date,
      weekday: s.weekday,
      level: s.level,
      title: s.title,
      defaultFocus: s.focus,
      slot: s.slot,
      timeSlot: slot,
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      topic: null,
      notes: null,
      status: "scheduled",
      postponedTo: null,
      edited: false,
      lecturerName: null,
      material: null,
    })),
  };
}
