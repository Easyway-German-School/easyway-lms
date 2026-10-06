import { batchFromAdmission, batchYearFromAdmission, resolveBatchWindow } from "@/lib/batch";

/**
 * Attendance is a statement a tutor makes about a class that happened. It can
 * only be true for a student whose classes have actually begun.
 *
 * A student who enrolled for the October batch is on the roster in September —
 * they are real, assigned and active — but nobody has taught them anything, so
 * "absent" is not a fact about them yet. Before this guard a register saved on
 * a day before their batch opened wrote them an absent row and sent them (and
 * their parent) a "Marked absent" notification.
 *
 * Rule, in order:
 *   1. An admin-confirmed first day (`classesStartedAt`) wins either way.
 *   2. Otherwise the batch month on the admission form decides.
 *   3. No usable signal → allow, so legacy rows keep working.
 */
export function classesHaveBegun(
  student: { admission?: unknown; classesStartedAt?: Date | string | null; createdAt?: Date | string | null },
  day: Date,
): boolean {
  const endOfDay = new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);

  if (student.classesStartedAt) {
    const started = new Date(student.classesStartedAt);
    if (!Number.isNaN(started.getTime())) return started.getTime() <= endOfDay.getTime();
  }

  const created = student.createdAt ? new Date(student.createdAt) : null;
  const window = resolveBatchWindow(batchFromAdmission(student.admission), {
    registeredAt: created && !Number.isNaN(created.getTime()) ? created : null,
    batchYear: batchYearFromAdmission(student.admission),
    now: endOfDay,
  });
  return window ? window.hasBegun : true;
}

export const ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Only an explicit, recognised status counts. Anything else is "not marked". */
export function explicitStatus(value: unknown): AttendanceStatus | null {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
    ? (value as AttendanceStatus)
    : null;
}
