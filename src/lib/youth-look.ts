/**
 * WHO GETS THE NEW LOOK — decided in one place.
 *
 * The student portal is being reshaped for the young learner: a phone tab bar,
 * avatars, a profile that reads like a feed, and a livelier community. That is
 * a real change to how the product feels, so the school sets a default by age
 * and the student always has the last word.
 *
 * Two cohorts, and a student belongs to exactly one:
 *
 *   WAVE     Under 25 (configurable). Gets the new look BY DEFAULT, and Becca
 *            tells them once — "we gave the app a fresh look, keep it or go
 *            back".
 *
 *   INVITED  Everyone else — including anybody whose age we cannot work out.
 *            Nothing changes for them, but Becca offers the choice once: try
 *            the new look, or stay exactly where you are. (This used to be
 *            only 25–34s who were demonstrably phone-heavy. That quietly hid
 *            the offer from most of the roster — a laptop user, a student with
 *            no birth date on file, anyone over 34 — so nobody who tested the
 *            portal as one of them ever saw it. The choice is now everyone's.)
 *
 * On top of that, the student's own choice wins over all of it, in both
 * directions, forever.
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
  const wave = input.wave ?? DEFAULT_LOOK_WAVE;
  const age = typeof input.age === "number" && Number.isFinite(input.age) ? input.age : null;
  const inWave = age === null ? wave.includeUnknownAge : age <= wave.maxAge;
  const cohort: Cohort = inWave ? "wave" : "invited";

  if (input.choice) return { look: input.choice, reason: "chosen", cohort, inWave };
  if (cohort === "wave") return { look: "youth", reason: "wave", cohort, inWave };
  return { look: "classic", reason: "default", cohort, inWave };
}

/**
 * Whether Becca should say something, and what. Only ever for a student who has
 * not been told before, and anyone who already picked a look themselves has
 * already answered the question.
 *
 * Everyone else gets one quiet banner on their next visit: wave students hear
 * that the look is theirs, everyone else is invited to try it. Join date and
 * account age used to hide this from most of the roster — new joiners, unknown
 * dates, anyone under two days — so the people who most needed the choice
 * never saw it. The banner itself waits its turn in the moment queue and can
 * be dismissed without a competing "skip" button.
 */
export function promptFor(decision: LookDecision, promptedBefore: boolean): "announce" | "invite" | null {
  if (promptedBefore || decision.reason === "chosen") return null;
  return decision.cohort === "wave" ? "announce" : "invite";
}
