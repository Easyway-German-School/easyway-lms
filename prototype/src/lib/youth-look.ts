/**
 * WHO GETS THE NEW LOOK — decided in one place.
 *
 * Used to be split by age (an under-25 "wave" got it by default, everyone
 * else was invited to opt in). That rollout is over: every student gets the
 * new look by default now, regardless of age — it is just the portal. Age and
 * the school's wave setting (`LookWave`) are kept as inputs for backward
 * compatibility with the admin reporting and the stored `SchoolSetting` row,
 * but `resolveLook` no longer lets either one change the outcome — see the
 * comment there.
 *
 * The student's own choice still wins over the default, in both directions,
 * forever — see `LookSwitch` on /profile.
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
  /**
   * Age-based rollout retired — everyone is "in the wave" now, regardless of
   * age or the stored LookWave setting. `age`/`wave` are still accepted (and
   * still typed) so none of the thirteen-odd callers — the admin cohort
   * report, the look-wave API, the student decision path — need to change,
   * but neither one is read here any more. The only thing that still moves
   * the outcome is the student's own choice, below.
   */
  const inWave = true;
  const cohort: Cohort = "wave";

  if (input.choice) return { look: input.choice, reason: "chosen", cohort, inWave };
  return { look: "youth", reason: "wave", cohort, inWave };
}

/**
 * Whether Becca should say something, and what. Only ever for a student who has
 * not been told before, and anyone who already picked a look themselves has
 * already answered the question.
 *
 * Now that the rollout is everyone's, `cohort` is always "wave", so this
 * always announces ("we gave the app a fresh look") rather than inviting —
 * the "invite" branch is dead with the age split retired, but left in place
 * since `LookDecision.cohort` still exists for the admin reporting's sake.
 * The banner itself waits its turn in the moment queue and can be dismissed
 * without a competing "skip" button.
 */
export function promptFor(decision: LookDecision, promptedBefore: boolean): "announce" | "invite" | null {
  if (promptedBefore || decision.reason === "chosen") return null;
  return decision.cohort === "wave" ? "announce" : "invite";
}
