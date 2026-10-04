/**
 * WHO GETS THE NEW LOOK — decided in one place.
 *
 * The student portal is being reshaped for the young learner: a phone tab bar,
 * avatars, a profile that reads like a feed. That is a real change to how the
 * product feels, so it goes out in waves by age rather than to everybody at
 * once — the older learners the age report tells us struggle most with the
 * portal are the last people who should have the layout move under them.
 *
 * Three inputs decide it, in this order:
 *
 *   1. The student's own choice. Someone who tapped "New look" or "Classic
 *      look" in their profile has answered the question; nothing overrides it.
 *   2. The wave. `maxAge` is the oldest age that gets the new look by default.
 *      It starts at 24 (the "Under 18" and "18 – 24" bands in lib/age-bands.ts)
 *      and is a SchoolSetting, so widening the pilot to 25–34 is a settings
 *      change and not a deploy.
 *   3. Not knowing. A student with no usable birth date stays on the classic
 *      look unless the wave says otherwise — guessing wrong in the direction of
 *      "moved your layout without asking" is the costlier mistake.
 *
 * Pure on purpose, like age-bands.ts: no I/O, unit-tested without a database,
 * and safe to import from client components.
 */

export type Look = "youth" | "classic";

/** SchoolSetting key the wave is stored under. */
export const LOOK_WAVE_KEY = "ui.look-wave";

export type LookWave = {
  /** Oldest age, inclusive, that gets the new look without asking. */
  maxAge: number;
  /** Whether a student whose age we cannot work out is in the wave. */
  includeUnknownAge: boolean;
};

/** Wave one: under 25. */
export const DEFAULT_LOOK_WAVE: LookWave = { maxAge: 24, includeUnknownAge: false };

/**
 * Reads a stored wave. Never throws: a malformed or missing row means "wave
 * one", exactly as if nobody had ever touched the setting.
 */
export function parseLookWave(raw: unknown): LookWave {
  if (!raw || typeof raw !== "object") return DEFAULT_LOOK_WAVE;
  const value = raw as { maxAge?: unknown; includeUnknownAge?: unknown };

  const maxAge =
    typeof value.maxAge === "number" && Number.isFinite(value.maxAge)
      ? Math.min(120, Math.max(0, Math.round(value.maxAge)))
      : DEFAULT_LOOK_WAVE.maxAge;

  return {
    maxAge,
    includeUnknownAge:
      typeof value.includeUnknownAge === "boolean"
        ? value.includeUnknownAge
        : DEFAULT_LOOK_WAVE.includeUnknownAge,
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
  /** Whether the age alone would have put this student in the wave. */
  inWave: boolean;
};

export function resolveLook(input: {
  age: number | null | undefined;
  choice: Look | null | undefined;
  wave?: LookWave;
}): LookDecision {
  const wave = input.wave ?? DEFAULT_LOOK_WAVE;
  const age = typeof input.age === "number" && Number.isFinite(input.age) ? input.age : null;
  const inWave = age === null ? wave.includeUnknownAge : age <= wave.maxAge;

  if (input.choice) return { look: input.choice, reason: "chosen", inWave };
  if (inWave) return { look: "youth", reason: "wave", inWave };
  return { look: "classic", reason: "default", inWave };
}
