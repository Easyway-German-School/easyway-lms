/**
 * WHO GETS THE NEW LOOK — decided in one place.
 *
 * The new student experience is now the default for every student, regardless
 * of age or any previously saved look preference. The retained wave shape is
 * only for compatibility with existing admin settings and analytics.
 *
 * What each look means for the community is decided from the same answer — see
 * lib/community-skin.ts: the new look gets the lively, avatar-first chat; the
 * classic look gets the familiar WhatsApp/Facebook-style one.
 *
 * Pure on purpose, like age-bands.ts: no I/O, unit-tested without a database,
 * and safe to import from client components.
 */

export type Look = "youth" | "classic";
export type Cohort = "wave" | "invited";

/** SchoolSetting key the wave is stored under. */
export const LOOK_WAVE_KEY = "ui.look-wave";

export type LookWave = {
  /** Oldest age, inclusive, that gets the new look without asking. */
  maxAge: number;
  /** Whether a student whose age we cannot work out is in the wave. */
  includeUnknownAge: boolean;
};

/** Wave one: under 25 get it; everybody else is offered it. */
export const DEFAULT_LOOK_WAVE: LookWave = {
  maxAge: 24,
  includeUnknownAge: false,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * Reads a stored wave. Never throws: a malformed or missing row means "wave
 * one", exactly as if nobody had ever touched the setting. Fields an older
 * version stored (the phone-usage invitation rules) are simply ignored.
 */
export function parseLookWave(raw: unknown): LookWave {
  if (!raw || typeof raw !== "object") return DEFAULT_LOOK_WAVE;
  const value = raw as Record<string, unknown>;

  return {
    maxAge: clampInt(value.maxAge, 0, 120, DEFAULT_LOOK_WAVE.maxAge),
    includeUnknownAge:
      typeof value.includeUnknownAge === "boolean" ? value.includeUnknownAge : DEFAULT_LOOK_WAVE.includeUnknownAge,
  };
}

/** What a student stored when they picked a look. Anything else is "no answer". */
export function parseLookChoice(raw: unknown): Look | null {
  return raw === "youth" || raw === "classic" ? raw : null;
}

export type LookDecision = {
  look: Look;
  /** Why — so the profile can say "you chose this" rather than guess. */
  reason: "chosen" | "wave" | "default";
  /** Which cohort the school's rules put this student in, before their own choice. */
  cohort: Cohort;
  /** Whether the age alone would have put this student in the wave. */
  inWave: boolean;
};

export function resolveLook(input: {
  age: number | null | undefined;
  choice: Look | null | undefined;
  wave?: LookWave;
}): LookDecision {
  void input;
  return { look: "youth", reason: "wave", cohort: "wave", inWave: true };
}

/**
 * Whether Becca should say something, and what. Only ever for a student who has
 * not been told before, and anyone who already picked a look themselves has
 * already answered the question.
 *
 * Students who have not seen the announcement get one quiet banner on their
 * next visit. The banner waits its turn in the moment queue.
 */
export function promptFor(decision: LookDecision, promptedBefore: boolean): "announce" | "invite" | null {
  void decision;
  return promptedBefore ? null : "announce";
}
