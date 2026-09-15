/**
 * The database side of the schedule-pattern setting — see schedule-pattern.ts
 * for the shape and why it exists. Kept apart from that file so it stays free
 * of prisma and importable by client code.
 */

import { prisma } from "@/lib/prisma";
import {
  SCHEDULE_PATTERN_KEY,
  emptySchedulePatternSettings,
  parseSchedulePatternSettings,
  type SchedulePatternSettings,
} from "@/lib/schedule-pattern";

/**
 * The office's weekday-pattern overrides, or "nothing overridden" if it has
 * never opened the setting. Never throws — a caller that cannot read this
 * should fall back to the built-in alternation, not fail the timetable.
 */
export async function readSchedulePatternSettings(): Promise<SchedulePatternSettings> {
  try {
    const row = await prisma.schoolSetting.findFirst({ where: { key: SCHEDULE_PATTERN_KEY } });
    return parseSchedulePatternSettings(row?.value);
  } catch {
    return emptySchedulePatternSettings();
  }
}
