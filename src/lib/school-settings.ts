/**
 * Which (session × attendance-mode) combinations a school actually runs, per
 * level — and the one place that decides it.
 *
 * The office turns a cell off on /admin/settings ("A1 · Morning · Online");
 * the sign-up form must stop offering it, the community must stop listing its
 * room, and the students already in it must be moved to the nearest session
 * that still runs THEIR mode (an online-morning student → online-afternoon,
 * staying online). Several screens have to agree, so the shape, the defaults,
 * the parsing and the "where does a stranded student go" arithmetic all live
 * here rather than being re-derived in each of them.
 *
 * Everything is permissive by default. A school that has never opened the
 * settings screen runs every session in every mode at every level, which is
 * what it was doing before the screen existed.
 *
 * v2: the grid replaced two independent level-wide axes (4 session booleans +
 * 3 mode booleans). "A1 mornings, but not online" was impossible to express;
 * now it is one row of the grid. An old stored value migrates cleanly — a cell
 * runs iff its old session flag AND its old mode flag were both on.
 */

export const CLASS_SESSIONS_KEY = "class.sessions";

/**
 * The levels this screen configures — what the school SELLS, not every level
 * that can exist on a record. C2 is not taught, so it gets no grid row, no
 * sign-up option and no community room.
 */
export { OFFERED_LEVELS as LEVELS } from "@/lib/levels";
import { OFFERED_LEVELS as LEVELS } from "@/lib/levels";

/** Time-of-day sessions. Order matters: `nearestEnabledSlotForMode` walks it. */
export const SESSION_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;

/** The Mon–Fri sessions — a family the nearest-slot search keeps within if it can. */
export const WEEKDAY_SLOTS = ["morning", "afternoon", "evening"] as const;

/**
 * How a student attends.
 *   physical — in the room at a campus branch.
 *   hybrid   — a campus student who also joins the same class over video.
 *   online   — the Online branch: no campus at all, for students who live
 *              nowhere near one.
 * The nearest-slot search keeps a student in the SAME mode — it only ever
 * changes which session they are in, never how they attend.
 */
export const MODE_SLOTS = ["physical", "hybrid", "online"] as const;

export type Level = (typeof LEVELS)[number];
export type SessionSlot = (typeof SESSION_SLOTS)[number];
export type ModeSlot = (typeof MODE_SLOTS)[number];

/** Which modes run in one session slot. */
export type ModeFlags = { physical: boolean; hybrid: boolean; online: boolean };

export type SessionConfig = {
  level: string;
  /** One entry per session slot; each says which of the three modes run. */
  grid: Record<SessionSlot, ModeFlags>;
};

export type SessionSettings = {
  sessions: SessionConfig[];
};

/** Human labels for the mode columns — the raw slug reads badly in a header. */
export const MODE_LABELS: Record<ModeSlot, string> = {
  physical: "On campus",
  hybrid: "Hybrid",
  online: "Online only",
};

/** Title-cased session name for UI ("morning" → "Morning"). */
export function slotTitle(slot: string): string {
  return slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : slot;
}

function allModesOn(): ModeFlags {
  return { physical: true, hybrid: true, online: true };
}

function allOn(level: string): SessionConfig {
  return {
    level,
    grid: {
      morning: allModesOn(),
      afternoon: allModesOn(),
      evening: allModesOn(),
      weekend: allModesOn(),
    },
  };
}

/** Every session in every mode at every level — how the school ran before this existed. */
export function defaultSessionSettings(): SessionSettings {
  return { sessions: LEVELS.map((level) => allOn(level)) };
}

/* ------------------------------------------------------------------ parsing */

type ParseOpts = { strict?: boolean };

/** Read one mode flag out of a cell object. Absent → true; wrong type → strict fails. */
function readFlag(source: Record<string, unknown>, key: string, strict: boolean): boolean | null {
  if (!(key in source)) return true;
  const raw = source[key];
  if (typeof raw !== "boolean") return strict ? null : true;
  return raw;
}

/** Read `{ physical, hybrid, online }` from a plain object, or null under strict on junk. */
function readModeFlags(value: unknown, strict: boolean): ModeFlags | null {
  if (!value || typeof value !== "object") return strict ? null : allModesOn();
  const record = value as Record<string, unknown>;
  const physical = readFlag(record, "physical", strict);
  const hybrid = readFlag(record, "hybrid", strict);
  const online = readFlag(record, "online", strict);
  if (physical === null || hybrid === null || online === null) return null;
  return { physical, hybrid, online };
}

/**
 * Migrate a pre-grid row: `{ morning, afternoon, …, physical, hybrid, online }`.
 * A cell runs iff its session flag AND its mode flag were both on. A mode flag
 * absent from the old row counts as on (that was the old lenient behaviour).
 */
function migrateFlatRow(record: Record<string, unknown>): Record<SessionSlot, ModeFlags> {
  const modeOn = (key: string) => (key in record ? Boolean(record[key]) : true);
  const p = modeOn("physical");
  const h = modeOn("hybrid");
  const o = modeOn("online");
  const grid = {} as Record<SessionSlot, ModeFlags>;
  for (const slot of SESSION_SLOTS) {
    const slotOn = Boolean(record[slot]);
    grid[slot] = { physical: slotOn && p, hybrid: slotOn && h, online: slotOn && o };
  }
  return grid;
}

export function parseSessionSettings(value: unknown): SessionSettings;
export function parseSessionSettings(value: unknown, options: { strict: true }): SessionSettings | null;
export function parseSessionSettings(value: unknown, options?: ParseOpts): SessionSettings | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : defaultSessionSettings();

  if (!value || typeof value !== "object") return fallback;
  const rows = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(rows)) return fallback;

  const byLevel = new Map<string, SessionConfig>();
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

    let grid: Record<SessionSlot, ModeFlags>;
    if (record.grid && typeof record.grid === "object") {
      const src = record.grid as Record<string, unknown>;
      grid = {} as Record<SessionSlot, ModeFlags>;
      for (const slot of SESSION_SLOTS) {
        const flags = readModeFlags(src[slot], strict);
        if (flags === null) return null;
        grid[slot] = flags;
      }
    } else if (strict) {
      // A POST from our own screen always carries a full grid.
      return null;
    } else {
      grid = migrateFlatRow(record);
    }

    byLevel.set(level, { level, grid });
  }

  return {
    sessions: LEVELS.map((level) => byLevel.get(level) ?? allOn(level)),
  };
}

/* ------------------------------------------------------------------ reading */

function rowFor(settings: SessionSettings | null | undefined, level: string | null | undefined) {
  if (!settings) return null;
  const wanted = String(level ?? "").trim().toUpperCase();
  return settings.sessions.find((entry) => entry.level === wanted) ?? null;
}

/** Does this exact (session × mode) run at this level? Unknown input → treated as open. */
export function isCellEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  slot: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  if (!settings) return true;
  const s = String(slot ?? "").trim().toLowerCase();
  const m = String(mode ?? "").trim().toLowerCase();
  if (!(SESSION_SLOTS as readonly string[]).includes(s)) return true;
  if (!(MODE_SLOTS as readonly string[]).includes(m)) return true;
  const row = rowFor(settings, level);
  if (!row) return true;
  return Boolean(row.grid[s as SessionSlot][m as ModeSlot]);
}

/** Does ANY mode run this session at this level? (The community room keys on session, not mode.) */
export function isSessionEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  slot: string | null | undefined,
): boolean {
  if (!settings) return true;
  const s = String(slot ?? "").trim().toLowerCase();
  if (!(SESSION_SLOTS as readonly string[]).includes(s)) return true;
  const row = rowFor(settings, level);
  if (!row) return true;
  return MODE_SLOTS.some((m) => row.grid[s as SessionSlot][m]);
}

/** Does ANY session run this mode at this level? (Used before a session is picked.) */
export function isModeEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  if (!settings) return true;
  const m = String(mode ?? "").trim().toLowerCase();
  if (!(MODE_SLOTS as readonly string[]).includes(m)) return true;
  const row = rowFor(settings, level);
  if (!row) return true;
  return SESSION_SLOTS.some((s) => row.grid[s][m as ModeSlot]);
}

/** Which sessions run a given mode at this level, in display order. */
export function enabledSlotsForMode(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  mode: string,
): SessionSlot[] {
  return SESSION_SLOTS.filter((slot) => isCellEnabled(settings, level, slot, mode));
}

/**
 * Where a student lands when their (session × mode) cell is switched off.
 *
 * The mode never changes — an online student stays online. Nearest by time of
 * day, and for a weekday student, staying on a weekday if any weekday session
 * still runs their mode (weekend runs a different course length). `null` means
 * no session runs this mode at this level any more: that student cannot be
 * auto-placed and goes to the office worklist instead.
 */
export function nearestEnabledSlotForMode(
  row: SessionConfig,
  slot: SessionSlot,
  mode: ModeSlot,
): SessionSlot | null {
  const order = SESSION_SLOTS;
  const index = order.indexOf(slot);
  const sameFamily = (candidate: SessionSlot) =>
    slot === "weekend" ? candidate === "weekend" : candidate !== "weekend";

  for (const restrictToFamily of [true, false]) {
    for (let distance = 1; distance < order.length; distance += 1) {
      for (const probe of [index + distance, index - distance]) {
        const candidate = order[probe];
        if (!candidate || candidate === slot) continue;
        if (restrictToFamily && !sameFamily(candidate)) continue;
        if (row.grid[candidate][mode]) return candidate;
      }
    }
  }
  return null;
}

export type DisabledCell = { level: string; slot: SessionSlot; mode: ModeSlot };

/** Every grid cell that flipped from on to off between two settings snapshots. */
export function diffDisabledCells(prev: SessionSettings, next: SessionSettings): DisabledCell[] {
  const out: DisabledCell[] = [];
  for (const nextRow of next.sessions) {
    const prevRow = prev.sessions.find((r) => r.level === nextRow.level);
    if (!prevRow) continue;
    for (const slot of SESSION_SLOTS) {
      for (const mode of MODE_SLOTS) {
        if (prevRow.grid[slot][mode] && !nextRow.grid[slot][mode]) {
          out.push({ level: nextRow.level, slot, mode });
        }
      }
    }
  }
  return out;
}

/** Levels a save would leave with no running cell at all — that save must be refused. */
export function levelsWithNoCell(settings: SessionSettings): string[] {
  return settings.sessions
    .filter((row) => !SESSION_SLOTS.some((s) => MODE_SLOTS.some((m) => row.grid[s][m])))
    .map((row) => row.level);
}
