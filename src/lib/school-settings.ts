/**
 * Which sittings AND attendance modes a school actually runs, and the one
 * place that decides it.
 *
 * The office turns a sitting (or a mode) off on /admin/settings; the sign-up
 * form must stop offering it, the community must stop listing its room, and the
 * students already in it must be moved somewhere that still runs. Those are
 * several screens that have to agree, so the shape, the defaults, the parsing
 * and the "where does a stranded student go" arithmetic all live here rather
 * than being re-derived in each of them — the failure this avoids is a level
 * greyed out at sign-up while its chat room stays open, or the reverse.
 *
 * Everything is permissive by default. A school that has never opened the
 * settings screen runs every sitting and every mode, which is what it was
 * doing before the screen existed.
 */

export const CLASS_SESSIONS_KEY = "class.sessions";

/**
 * The levels this screen configures — what the school SELLS, not every level
 * that can exist on a record. C2 is not taught, so it gets no sittings row, no
 * sign-up option and no community room.
 */
export { OFFERED_LEVELS as LEVELS } from "@/lib/levels";
import { OFFERED_LEVELS as LEVELS } from "@/lib/levels";

/** Time-of-day sittings. Order matters: `nearestEnabledSlot` walks it. */
export const SESSION_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;

/** The Mon–Fri sittings — a family `nearestEnabledSlot` keeps within if it can. */
export const WEEKDAY_SLOTS = ["morning", "afternoon", "evening"] as const;

/**
 * How a student attends.
 *   physical — in the room at a campus branch.
 *   hybrid   — a campus student who also joins the same class over video.
 *   online   — the Online branch: no campus at all, for students who live
 *              nowhere near one. It has no in-person fallback, which is why
 *              `nearestEnabledMode` never routes anyone INTO or OUT OF it.
 */
export const MODE_SLOTS = ["physical", "hybrid", "online"] as const;

export type Level = (typeof LEVELS)[number];
export type SessionSlot = (typeof SESSION_SLOTS)[number];
export type ModeSlot = (typeof MODE_SLOTS)[number];

export type SessionConfig = {
  level: string;
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
  weekend: boolean;
  physical: boolean;
  hybrid: boolean;
  online: boolean;
};

export type SessionSettings = {
  sessions: SessionConfig[];
};

/** Human labels for the mode toggles — the raw slug reads badly in a checkbox. */
export const MODE_LABELS: Record<ModeSlot, string> = {
  physical: "On campus",
  hybrid: "Hybrid",
  online: "Online only",
};

function allOn(level: string): SessionConfig {
  return {
    level,
    morning: true,
    afternoon: true,
    evening: true,
    weekend: true,
    physical: true,
    hybrid: true,
    online: true,
  };
}

/** Every sitting and every mode at every level — how the school ran before this existed. */
export function defaultSessionSettings(): SessionSettings {
  return { sessions: LEVELS.map((level) => allOn(level)) };
}

/**
 * Read a stored value back into a known shape.
 *
 * Two callers with opposite needs, hence the flag. Reading from the database
 * must never throw — a row hand-edited into nonsense should degrade to "all
 * sittings run", not take down the sign-up form. Accepting a POST must be
 * strict, because that is the moment to reject nonsense rather than store it.
 *
 * The three MODE flags default to `true` when a stored row does not carry them
 * at all: a row written before modes existed on this screen must keep offering
 * every mode, not silently lose two of three.
 */
export function parseSessionSettings(value: unknown): SessionSettings;
export function parseSessionSettings(value: unknown, options: { strict: true }): SessionSettings | null;
export function parseSessionSettings(
  value: unknown,
  options?: { strict?: boolean },
): SessionSettings | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : defaultSessionSettings();

  if (!value || typeof value !== "object") return fallback;

  const rows = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(rows)) return fallback;

  /** Present-but-not-boolean fails strict; absent defaults to `true`. */
  const modeFlag = (row: Record<string, unknown>, key: string): boolean | null => {
    if (!(key in row)) return true;
    const raw = row[key];
    if (typeof raw !== "boolean") return strict ? null : true;
    return raw;
  };

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

    const physical = modeFlag(record, "physical");
    const hybrid = modeFlag(record, "hybrid");
    const online = modeFlag(record, "online");
    if (physical === null || hybrid === null || online === null) return null;

    byLevel.set(level, {
      level,
      morning: Boolean(record.morning),
      afternoon: Boolean(record.afternoon),
      evening: Boolean(record.evening),
      weekend: Boolean(record.weekend),
      physical,
      hybrid,
      online,
    });
  }

  /**
   * Always returned as the full offered-levels list in a fixed order. A level
   * missing from the stored value falls back to fully open rather than
   * vanishing from the settings screen, which is how a level would otherwise
   * become impossible to re-enable once it had been dropped.
   */
  return {
    sessions: LEVELS.map((level) => byLevel.get(level) ?? allOn(level)),
  };
}

function rowFor(settings: SessionSettings | null | undefined, level: string | null | undefined) {
  if (!settings) return null;
  const wanted = String(level ?? "").trim().toUpperCase();
  return settings.sessions.find((entry) => entry.level === wanted) ?? null;
}

/** Is this sitting offered at this level? Unknown input is treated as open. */
export function isSessionEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  slot: string | null | undefined,
): boolean {
  if (!settings) return true;
  const wantedSlot = String(slot ?? "").trim().toLowerCase();
  if (!(SESSION_SLOTS as readonly string[]).includes(wantedSlot)) return true;
  const row = rowFor(settings, level);
  if (!row) return true;
  return Boolean(row[wantedSlot as SessionSlot]);
}

/** Is this attendance mode offered at this level? Unknown input is treated as open. */
export function isModeEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  mode: string | null | undefined,
): boolean {
  if (!settings) return true;
  const wantedMode = String(mode ?? "").trim().toLowerCase();
  if (!(MODE_SLOTS as readonly string[]).includes(wantedMode)) return true;
  const row = rowFor(settings, level);
  if (!row) return true;
  return Boolean(row[wantedMode as ModeSlot]);
}

/**
 * Where a student lands when their sitting is switched off.
 *
 * Nearest by time of day, and — for a weekday student — staying on a weekday
 * sitting if any is left, because weekend runs a different course length
 * (`sessionDurationMonths`) and crossing that boundary shifts their end date.
 * `null` means the level has no sitting left at all, which the save path must
 * refuse before it ever gets here.
 */
export function nearestEnabledSlot(row: SessionConfig, slot: SessionSlot): SessionSlot | null {
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
        if (row[candidate]) return candidate;
      }
    }
  }
  return null;
}

/**
 * Where a student lands when their attendance mode is switched off.
 *
 * hybrid ⇄ physical only — both are the same campus, so the swap costs the
 * student nothing but a video feed. `online` is deliberately never a source or
 * a target: an online student is remote by necessity, so switching their mode
 * off is handled by the office by hand, not by this function.
 */
export function nearestEnabledMode(row: SessionConfig, mode: ModeSlot): ModeSlot | null {
  if (mode === "hybrid") return row.physical ? "physical" : null;
  if (mode === "physical") return row.hybrid ? "hybrid" : null;
  return null;
}

export type DisabledChange = {
  level: string;
  kind: "slot" | "mode";
  key: SessionSlot | ModeSlot;
};

/** Every toggle that flipped from on to off between two settings snapshots. */
export function diffDisabled(prev: SessionSettings, next: SessionSettings): DisabledChange[] {
  const out: DisabledChange[] = [];
  for (const nextRow of next.sessions) {
    const prevRow = prev.sessions.find((r) => r.level === nextRow.level);
    if (!prevRow) continue;
    for (const key of SESSION_SLOTS) {
      if (prevRow[key] && !nextRow[key]) out.push({ level: nextRow.level, kind: "slot", key });
    }
    for (const key of MODE_SLOTS) {
      if (prevRow[key] && !nextRow[key]) out.push({ level: nextRow.level, kind: "mode", key });
    }
  }
  return out;
}

/** Levels left with no time slot at all — a save that produces one must be refused. */
export function levelsWithNoSlot(settings: SessionSettings): string[] {
  return settings.sessions
    .filter((row) => !SESSION_SLOTS.some((slot) => row[slot]))
    .map((row) => row.level);
}

/** Levels left with no attendance mode at all — same rule. */
export function levelsWithNoMode(settings: SessionSettings): string[] {
  return settings.sessions
    .filter((row) => !MODE_SLOTS.some((mode) => row[mode]))
    .map((row) => row.level);
}
