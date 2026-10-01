import { batchFromAdmission } from "@/lib/batch";
import { resolveUpcomingBatch } from "@/lib/batch-reservation";
import type { IntakeStartDayOverrides } from "@/lib/intake";

/**
 * Attendance is a statement a tutor makes about a class that happened. It can
 * only be true for a student whose classes have actually begun.
 *
 * A student who enrolled for the October batch is on the roster in September —
 * real, assigned and active — but nobody has taught them anything, so "absent"
 * is not a fact about them yet. Before this guard, a register saved before
 * their batch opened wrote them an absent row and sent them (and their parent)
 * a "Marked absent" notification while their portal was still locked.
 *
 * This asks the SAME question the portal lock asks (`resolveUpcomingBatch`,
 * the per-level opening days included), so "locked until the batch opens" and
 * "cannot be marked" can never disagree.
 */
export function classesHaveBegun(
  student: {
    level?: string | null;
    admission?: unknown;
    classesStartedAt?: Date | string | null;
    createdAt?: Date | string | null;
  },
  day: Date,
  startDayOverrides?: IntakeStartDayOverrides,
): boolean {
  return (
    resolveUpcomingBatch(batchFromAdmission(student.admission), {
      registeredAt: student.createdAt,
      classesStartedAt: student.classesStartedAt,
      // The attendance day itself, not its end: a class that opens on the 5th
      // can be marked on the 5th but not on the 4th.
      now: day,
      startDayOverrides,
      level: student.level,
    }) === null
  );
}

export const ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Only an explicit, recognised status counts. Anything else is "not marked". */
export function explicitStatus(value: unknown): AttendanceStatus | null {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value)
    ? (value as AttendanceStatus)
    : null;
}
