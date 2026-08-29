import { prisma } from "@/lib/prisma";
import type { MergedMonth, MergedSession } from "@/lib/class-sessions";
import { topUpSeriesForStudent } from "@/lib/private-class-series";

/**
 * Calendars for one-to-one students.
 *
 * A private student sits no branch+level rotation, so the generated timetable
 * does not describe their week at all — showing them one would tell them to
 * turn up on days they have no class. Their calendar is PrivateClass rows and
 * nothing else.
 *
 * The output deliberately matches the shape /api/schedule already returns, so
 * the student calendar renders it without knowing which kind of student it is
 * looking at.
 */

/**
 * Fills in `attendanceStatus` for a session that has already ended, the
 * first time anyone reads it, so a tutor never has to remember to mark it by
 * hand for an online class the room itself already has the answer for.
 *
 * Only derives for online/hybrid — a physical session has no
 * `LiveClassInvite` row to read (nobody logs into a room that doesn't
 * exist), so those stay null until a human marks them. Never overwrites an
 * existing value: once anyone (the derivation or a manual edit) has set it,
 * this is a no-op — that is what makes a manual correction stick.
 */
export async function ensureAttendanceComputed(privateClass: {
  id: string;
  studentId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
  deliveryMode: string | null;
  attendanceStatus: string | null;
}, studentDeliveryMode: string): Promise<string | null> {
  if (privateClass.attendanceStatus) return privateClass.attendanceStatus;
  if (!["scheduled", "completed"].includes(privateClass.status)) return null;

  const end = new Date(privateClass.scheduledAt.getTime() + privateClass.durationMinutes * 60_000);
  if (end.getTime() > Date.now()) return null;

  const mode = privateClass.deliveryMode ?? studentDeliveryMode;
  if (mode === "physical") return null;

  const session = await prisma.liveClassSession.findFirst({
    where: { privateClassId: privateClass.id },
    select: { id: true },
  });
  const invite = session
    ? await prisma.liveClassInvite.findUnique({
        where: { sessionId_studentId: { sessionId: session.id, studentId: privateClass.studentId } },
        select: { status: true },
      })
    : null;
  const computed = invite?.status === "joined" ? "present" : "no_show";

  await prisma.privateClass.update({ where: { id: privateClass.id }, data: { attendanceStatus: computed } }).catch(() => {});
  return computed;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Maps a private-class status onto the states the calendar already renders. */
function displayStatus(status: string): string {
  if (status === "cancelled" || status === "skipped") return "cancelled";
  if (status === "postponed") return "postponed";
  if (status === "completed") return "held";
  return "scheduled";
}

/**
 * A private class is booked at an exact time rather than into one of the three
 * house sittings, but the calendar still labels every session with a sitting.
 * Derive it from the hour so an 18:30 class does not read "Morning session".
 */
function slotForHour(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 16) return "afternoon";
  return "evening";
}

export async function getPrivateSchedule(args: {
  studentId: string;
  level: string;
  now?: Date;
  months?: number;
}): Promise<{ level: string; batchMonth: string; batchYear: number; months: MergedMonth[] }> {
  const now = args.now ?? new Date();
  const monthCount = args.months ?? 2;

  // Tops up any recurring series to `WINDOW_WEEKS` ahead before reading —
  // this is the "generate lazily on read" entry point for the student's own
  // calendar. Cheap when there is nothing to top up (an early return per
  // series once its window is already full).
  await topUpSeriesForStudent(args.studentId, now);

  const windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth() + monthCount, 1);

  const classes = await prisma.privateClass.findMany({
    where: {
      studentId: args.studentId,
      status: { in: ["scheduled", "completed", "postponed", "skipped"] },
      scheduledAt: { gte: windowStart, lt: windowEnd },
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
    orderBy: { scheduledAt: "asc" },
  });

  const months: MergedMonth[] = [];

  for (let i = 0; i < monthCount; i += 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthIndex = cursor.getMonth();
    const year = cursor.getFullYear();

    const inMonth = classes.filter(
      (c) => c.scheduledAt.getMonth() === monthIndex && c.scheduledAt.getFullYear() === year,
    );

    const sessions: MergedSession[] = inMonth.map((c) => {
      const end = new Date(c.scheduledAt.getTime() + c.durationMinutes * 60_000);
      return {
        date: c.scheduledAt.toISOString(),
        weekday: WEEKDAY_SHORT[c.scheduledAt.getDay()],
        level: args.level,
        title: `${args.level} · Private class`,
        defaultFocus: "One-to-one session",
        slot: "Private class",
        timeSlot: slotForHour(c.scheduledAt.getHours()),
        startTime: clockTime(c.scheduledAt),
        endTime: clockTime(end),
        topic: c.topic,
        notes: c.notes,
        status: displayStatus(c.status),
        postponedTo: null,
        edited: true,
        lecturerName: c.lecturer?.user?.name ?? null,
        // Shaped the same as a group session's material, so the calendar has
        // one thing to render rather than two nearly-identical ones.
        material: c.material
          ? {
              id: c.material.id,
              title: c.material.title,
              filePath: c.material.filePath,
              fileType: c.material.fileType,
              aiSummary: c.material.aiSummary,
              aiQuestCount: Array.isArray(c.material.aiQuests) ? c.material.aiQuests.length : 0,
            }
          : null,
      };
    });

    months.push({
      label: `${MONTH_NAMES[monthIndex]} ${year}`,
      monthIndex,
      year,
      offset: i,
      isBatchStart: i === 0,
      patternDays: [...new Set(inMonth.map((c) => c.scheduledAt.getDay()))].sort(),
      patternLabel: sessions.length ? "Booked one-to-one sessions" : "No sessions booked",
      sessions,
    });
  }

  return {
    level: args.level,
    batchMonth: MONTH_NAMES[now.getMonth()],
    batchYear: now.getFullYear(),
    months,
  };
}
