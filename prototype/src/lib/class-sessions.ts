import { prisma } from "@/lib/prisma";
import { generatePersonalizedSchedule, type ScheduleMonth } from "@/lib/schedule";
import { SLOT_DEFAULTS, normalizeSlot, isWeekendSlot, type TimeSlot } from "@/lib/class-times";
import { sessionDurationMonths } from "@/lib/levels";
import { SCHOOL_TIMEZONE, zonedDateKey } from "@/lib/school-time";

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

// The hours themselves live in lib/class-times, which has no prisma import so
// the signup form can read the same table this does. Re-exported here because
// a dozen server routes already import them from this module.
export { TIME_SLOTS, SLOT_DEFAULTS, normalizeSlot, type TimeSlot } from "@/lib/class-times";

/**
 * The join key between the skeleton and its overrides: midnight UTC stamped on
 * the calendar day the class falls on **in the school's timezone**.
 *
 * Anchored to `SCHOOL_TIMEZONE` explicitly rather than to whatever zone the
 * code runs in — so a generated session, a tutor's override write, and every
 * read resolve to the same day whether this runs on Vercel (UTC) or a laptop
 * in Lagos. On the UTC production server this is identical to the old
 * local-components behaviour; it only removes the drift in local dev.
 */
export function dayKey(date: Date | string): Date {
  return new Date(`${zonedDateKey(new Date(date), SCHOOL_TIMEZONE)}T00:00:00.000Z`);
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
  /** Short zone the times are quoted in ("WAT", "CEST") — set for private sessions. */
  zoneLabel?: string;
  topic: string | null;
  notes: string | null;
  status: string;
  postponedTo: string | null;
  /** True when a tutor has actually touched this day. */
  edited: boolean;
  lecturerName: string | null;
  material: {
    id: string;
    title: string;
    filePath: string;
    fileType: string;
    /**
     * What the AI made of it, generated in the background after upload.
     * Carried through to the calendar so a student deciding whether to open a
     * 14-page PDF can read two sentences first — which is the difference
     * between a material being downloaded and a material being ignored.
     */
    aiSummary: string | null;
    /** Just the count: the quests themselves live on the materials page. */
    aiQuestCount: number;
  } | null;
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
  /** When the student registered — decides WHICH occurrence of the batch month. */
  registeredAt?: Date | null;
  sessionSlot?: string | null;
  now?: Date;
  months?: number;
}): Promise<{ level: string; batchMonth: string; batchYear: number; sessionSlot: TimeSlot; months: MergedMonth[] }> {
  const slot = normalizeSlot(args.sessionSlot);

  const generated = generatePersonalizedSchedule({
    level: args.level,
    batch: args.batch ?? null,
    registeredAt: args.registeredAt ?? null,
    now: args.now,
    months: args.months ?? sessionDurationMonths(slot),
    sessionSlot: slot,
  });

  const allDates = generated.months.flatMap((m) => m.sessions.map((s) => dayKey(s.date)));
  if (!args.branchId || allDates.length === 0) {
    return { ...generated, sessionSlot: slot, months: generated.months.map((m) => withDefaults(m, slot)) };
  }

  // The rotation engine says which days a cohort normally meets; a tutor (or the
  // office) can also ADD a one-off — an extra revision Saturday, a catch-up —
  // via POST /api/lecturer/sessions. Those rows land on a day the skeleton
  // never generated, so the query has to be the whole course window, not just
  // `allDates`, or an added class would be invisible to students.
  const first = generated.months[0];
  const last = generated.months[generated.months.length - 1];
  const windowStart = new Date(Date.UTC(first.year, first.monthIndex, 1));
  const windowEnd = new Date(Date.UTC(last.year, last.monthIndex + 1, 0, 23, 59, 59, 999));

  const overrides = await prisma.classSession.findMany({
    where: {
      branchId: args.branchId,
      level: generated.level,
      timeSlot: slot,
      date: { gte: windowStart, lte: windowEnd },
    },
    include: {
      lecturer: { select: { user: { select: { name: true } } } },
      material: {
        select: {
          id: true, title: true, filePath: true, fileType: true,
          aiSummary: true, aiQuests: true,
        },
      },
    },
  });

  // Key by day so lookup during the merge is O(1).
  const byDay = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) byDay.set(o.date.toISOString(), o);

  // Rows that don't sit on a generated day are added classes — bucket them by
  // calendar month so they can be spliced into the right month below.
  const generatedDayKeys = new Set(allDates.map((d) => d.toISOString()));
  const extrasByMonth = new Map<string, MergedSession[]>();
  for (const o of overrides) {
    if (generatedDayKeys.has(o.date.toISOString())) continue;
    const rowSlot = normalizeSlot(o.timeSlot);
    const rowDefaults = SLOT_DEFAULTS[rowSlot];
    const monthKey = `${o.date.getUTCFullYear()}-${o.date.getUTCMonth()}`;
    const list = extrasByMonth.get(monthKey) ?? [];
    list.push({
      date: o.date.toISOString(),
      weekday: EXTRA_WEEKDAY_SHORT[o.date.getUTCDay()],
      level: generated.level,
      title: o.topic?.trim() ? o.topic.trim() : `${generated.level} · Added class`,
      defaultFocus: "Added class",
      slot: "Live Class",
      timeSlot: rowSlot,
      startTime: o.startTime || rowDefaults.startTime,
      endTime: o.endTime || rowDefaults.endTime,
      zoneLabel: GROUP_ZONE_LABEL,
      topic: o.topic ?? null,
      notes: o.notes ?? null,
      status: o.status ?? "scheduled",
      postponedTo: o.postponedTo ? o.postponedTo.toISOString() : null,
      edited: true,
      lecturerName: o.lecturer?.user?.name ?? null,
      material: o.material
        ? {
            id: o.material.id,
            title: o.material.title,
            filePath: o.material.filePath,
            fileType: o.material.fileType,
            aiSummary: o.material.aiSummary,
            aiQuestCount: Array.isArray(o.material.aiQuests) ? o.material.aiQuests.length : 0,
          }
        : null,
    });
    extrasByMonth.set(monthKey, list);
  }

  const months = generated.months.map((month) => ({
    ...month,
    sessions: mergeExtras(extrasByMonth.get(`${month.year}-${month.monthIndex}`) ?? [], month.sessions.map((s) => {
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
        zoneLabel: GROUP_ZONE_LABEL,
        topic: override?.topic ?? null,
        notes: override?.notes ?? null,
        status: override?.status ?? "scheduled",
        postponedTo: override?.postponedTo ? override.postponedTo.toISOString() : null,
        edited: Boolean(override),
        lecturerName: override?.lecturer?.user?.name ?? null,
        material: override?.material
          ? {
              id: override.material.id,
              title: override.material.title,
              filePath: override.material.filePath,
              fileType: override.material.fileType,
              aiSummary: override.material.aiSummary,
              aiQuestCount: Array.isArray(override.material.aiQuests)
                ? override.material.aiQuests.length
                : 0,
            }
          : null,
      } satisfies MergedSession;
    })),
  }));

  return { ...generated, sessionSlot: slot, months };
}

const EXTRA_WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Group classes are quoted in school hours by definition; Lagos has no DST. */
const GROUP_ZONE_LABEL = "WAT";

/**
 * Splice a month's added classes into its generated sessions, ordered by the
 * moment the class actually starts (the ISO strings mix local- and UTC-midnight
 * across timezones, so compare times, not text).
 */
function mergeExtras(extras: MergedSession[], base: MergedSession[]): MergedSession[] {
  if (extras.length === 0) return base;
  return [...base, ...extras].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
      zoneLabel: GROUP_ZONE_LABEL,
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
