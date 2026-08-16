/**
 * Which sittings a school actually runs, and the one place that decides it.
 *
 * The office turns a sitting off on /admin/settings; the sign-up form must
 * stop offering it and the community must stop listing its room. Those are
 * three screens that have to agree, so the shape, the defaults and the parsing
 * live here rather than being re-derived in each of them — the failure this
 * avoids is a level greyed out at sign-up while its chat room stays open, or
 * the reverse.
 *
 * Everything is permissive by default. A school that has never opened the
 * settings screen runs every sitting, which is what it was doing before the
 * screen existed.
 */

export const CLASS_SESSIONS_KEY = "class.sessions";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const SESSION_SLOTS = ["morning", "afternoon", "evening"] as const;

export type Level = (typeof LEVELS)[number];
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export type SessionConfig = {
  level: string;
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
};

export type SessionSettings = {
  sessions: SessionConfig[];
};

/** Every sitting at every level, which is how the school ran before this existed. */
export function defaultSessionSettings(): SessionSettings {
  return {
    sessions: LEVELS.map((level) => ({
      level,
      morning: true,
      afternoon: true,
      evening: true,
    })),
  };
}

/**
 * Read a stored value back into a known shape.
 *
 * Two callers with opposite needs, hence the flag. Reading from the database
 * must never throw — a row hand-edited into nonsense should degrade to "all
 * sittings run", not take down the sign-up form. Accepting a POST must be
 * strict, because that is the moment to reject nonsense rather than store it.
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

  const byLevel = new Map<string, SessionConfig>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      if (strict) return null;
      continue;
    }
    const level = String((row as { level?: unknown }).level ?? "").trim().toUpperCase();
    if (!(LEVELS as readonly string[]).includes(level)) {
      if (strict) return null;
      continue;
    }
    byLevel.set(level, {
      level,
      morning: Boolean((row as SessionConfig).morning),
      afternoon: Boolean((row as SessionConfig).afternoon),
      evening: Boolean((row as SessionConfig).evening),
    });
  }

  /**
   * Always returned as the full six levels in a fixed order. A level missing
   * from the stored value falls back to open rather than vanishing from the
   * settings screen, which is how a level would otherwise become impossible to
   * re-enable once it had been dropped.
   */
  return {
    sessions: LEVELS.map(
      (level) => byLevel.get(level) ?? { level, morning: true, afternoon: true, evening: true },
    ),
  };
}

/** Is this sitting offered at this level? Unknown input is treated as open. */
export function isSessionEnabled(
  settings: SessionSettings | null | undefined,
  level: string | null | undefined,
  slot: string | null | undefined,
): boolean {
  if (!settings) return true;

  const wantedLevel = String(level ?? "").trim().toUpperCase();
  const wantedSlot = String(slot ?? "").trim().toLowerCase();
  if (!(SESSION_SLOTS as readonly string[]).includes(wantedSlot)) return true;

  const row = settings.sessions.find((entry) => entry.level === wantedLevel);
  if (!row) return true;

  return Boolean(row[wantedSlot as SessionSlot]);
}
