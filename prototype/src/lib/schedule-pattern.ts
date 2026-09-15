/**
 * Admin override for which weekdays a (level, session-slot) class meets.
 *
 * `schedule.ts` used to hardcode this: consecutive batches alternate between
 * Mon/Fri/Sat and Tue/Wed/Thu, weekend is always Saturday. That rule is still
 * the DEFAULT here — nothing changes for a school that never opens this
 * setting — but the office can now pin a level+session to explicit days when
 * the batch is no longer running the fixed rotation the code assumed.
 *
 * No `@/lib/prisma` import, same reason as school-settings.ts: this is read by
 * schedule.ts, which a client component (the smart-calendar UI) can end up
 * importing for its types.
 */

import { OFFERED_LEVELS as LEVELS } from "@/lib/levels";
import { TIME_SLOTS as SESSION_SLOTS, isWeekendSlot, type TimeSlot } from "@/lib/class-times";

export const SCHEDULE_PATTERN_KEY = "class.schedule-pattern";

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ---- the built-in defaults — unchanged from before this setting existed ---
const PATTERN_MFS = [1, 5, 6]; // Mon, Fri, Sat
const PATTERN_TWT = [2, 3, 4]; // Tue, Wed, Thu
const PATTERN_WEEKEND = [6]; // Sat only

/** The alternating default for a weekday sitting — see schedule.ts for why it keys on the batch's own month. */
export function defaultPatternForBatch(batchMonthIndex: number): number[] {
  return batchMonthIndex % 2 === 1 ? PATTERN_MFS : PATTERN_TWT;
}

export function patternLabel(days: number[]): string {
  if (!days.length) return "—";
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT[d])
    .join(" · ");
}

/** One level's overrides: a slot present in the grid replaces the default; a slot absent still uses it. */
export type SchedulePatternGrid = Partial<Record<TimeSlot, number[]>>;
export type SchedulePatternRow = { level: string; grid: SchedulePatternGrid };
export type SchedulePatternSettings = { levels: SchedulePatternRow[] };

export function emptySchedulePatternSettings(): SchedulePatternSettings {
  return { levels: [] };
}

function isValidDays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    new Set(value).size === value.length
  );
}

type ParseOpts = { strict?: boolean };

export function parseSchedulePatternSettings(value: unknown): SchedulePatternSettings;
export function parseSchedulePatternSettings(value: unknown, options: { strict: true }): SchedulePatternSettings | null;
export function parseSchedulePatternSettings(value: unknown, options?: ParseOpts): SchedulePatternSettings | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : emptySchedulePatternSettings();

  if (!value || typeof value !== "object") return fallback;
  const rows = (value as { levels?: unknown }).levels;
  if (!Array.isArray(rows)) return fallback;

  const byLevel = new Map<string, SchedulePatternRow>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      if (strict) return null;
      continue;
    }
    const record = row as Record<string, unknown>;
    const level = String(record.level ?? "").trim().toUpperCase();
    if (!(LEVELS as readonly string[]).includes(level)) {
      if (strict) return null;
      continue;
    }

    const src = record.grid && typeof record.grid === "object" ? (record.grid as Record<string, unknown>) : null;
    if (!src) {
      if (strict) return null;
      continue;
    }

    const grid: SchedulePatternGrid = {};
    for (const slot of SESSION_SLOTS) {
      const raw = src[slot];
      if (raw === undefined || raw === null) continue; // no override for this cell — stays on the default
      if (!isValidDays(raw)) {
        if (strict) return null;
        continue;
      }
      grid[slot] = [...raw].sort((a, b) => a - b);
    }
    byLevel.set(level, { level, grid });
  }

  return { levels: [...byLevel.values()] };
}

/** The days a (level, slot) class actually meets: the office's override if set, else the built-in default. */
export function resolvePatternDays(
  settings: SchedulePatternSettings | null | undefined,
  level: string,
  slot: TimeSlot,
  batchMonthIndex: number,
): number[] {
  const row = settings?.levels.find((r) => r.level === level.toUpperCase());
  const override = row?.grid[slot];
  if (override && override.length) return override;
  return isWeekendSlot(slot) ? PATTERN_WEEKEND : defaultPatternForBatch(batchMonthIndex);
}
