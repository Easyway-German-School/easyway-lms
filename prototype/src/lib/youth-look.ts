/**
 * WHO GETS THE NEW LOOK — decided in one place.
 *
 * The student portal is being reshaped for the young learner: a phone tab bar,
 * avatars, a profile that reads like a feed. That is a real change to how the
 * product feels, so it goes out by cohort rather than to everybody at once —
 * the older learners the age report tells us struggle most with the portal are
 * the last people who should have the layout move under them.
 *
 * Three cohorts, and a student belongs to exactly one:
 *
 *   WAVE     Under 25 (configurable). Gets the new look BY DEFAULT, and Becca
 *            tells them once — "we gave the app a fresh look, keep it or go
 *            back".
 *
 *   INVITED  A little older (25–34) AND demonstrably living on their phone —
 *            most of their recent portal activity is on a mobile. Nothing
 *            changes for them; Becca asks once whether they would like to try
 *            it. The phone-share test is the data doing the work: a bottom tab
 *            bar is built for a thumb, so it is offered to the people who are
 *            already using the portal with one.
 *
 *   CLASSIC  Everyone else, including anybody whose age we cannot work out. They
 *            are never prompted. The switch on their profile is always there.
 *
 * On top of that, the student's own choice wins over all of it, in both
 * directions, forever. The school sets the default; the student decides.
 *
 * Pure on purpose, like age-bands.ts: no I/O, unit-tested without a database,
 * and safe to import from client components.
 */

export type Look = "youth" | "classic";
export type Cohort = "wave" | "invited" | "classic";

/** SchoolSetting key the wave is stored under. */
export const LOOK_WAVE_KEY = "ui.look-wave";

export type LookWave = {
  /** Oldest age, inclusive, that gets the new look without asking. */
  maxAge: number;
  /** Whether a student whose age we cannot work out is in the wave. */
  includeUnknownAge: boolean;
  /** Oldest age, inclusive, that is INVITED to try it. Equal to maxAge switches invitations off. */
  inviteMaxAge: number;
  /** Share (0–1) of recent portal activity that must be on a phone to be invited. */
  invitePhoneShare: number;
  /** Fewest recent activity events before the phone share is believed. */
  inviteMinEvents: number;
};

/** Wave one: under 25 get it, 25–34 who live on their phone are invited. */
export const DEFAULT_LOOK_WAVE: LookWave = {
  maxAge: 24,
  includeUnknownAge: false,
  inviteMaxAge: 34,
  invitePhoneShare: 0.6,
  inviteMinEvents: 10,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * Reads a stored wave. Never throws: a malformed or missing row means "wave
 * one", exactly as if nobody had ever touched the setting.
 */
export function parseLookWave(raw: unknown): LookWave {
  if (!raw || typeof raw !== "object") return DEFAULT_LOOK_WAVE;
  const value = raw as Record<string, unknown>;

  const maxAge = clampInt(value.maxAge, 0, 120, DEFAULT_LOOK_WAVE.maxAge);
  // Invitations can never reach DOWN into the wave: the oldest invited age is at least the wave's.
  const inviteMaxAge = Math.max(maxAge, clampInt(value.inviteMaxAge, 0, 120, DEFAULT_LOOK_WAVE.inviteMaxAge));

  return {
    maxAge,
    includeUnknownAge:
      typeof value.includeUnknownAge === "boolean" ? value.includeUnknownAge : DEFAULT_LOOK_WAVE.includeUnknownAge,
    inviteMaxAge,
    invitePhoneShare:
      typeof value.invitePhoneShare === "number" && Number.isFinite(value.invitePhoneShare)
        ? Math.min(1, Math.max(0, value.invitePhoneShare))
        : DEFAULT_LOOK_WAVE.invitePhoneShare,
    inviteMinEvents: clampInt(value.inviteMinEvents, 1, 10_000, DEFAULT_LOOK_WAVE.inviteMinEvents),
  };
}

/** What a student stored when they picked a look. Anything else is "no answer". */
export function parseLookChoice(raw: unknown): Look | null {
  return raw === "youth" || raw === "classic" ? raw : null;
}

/** How a student has been using the portal lately — the invitation's evidence. */
export type PhoneUsage = {
  /** Activity events in the recent window. */
  events: number;
  /** Of those, how many came from a phone. */
  mobileEvents: number;
};

export type LookDecision = {
  look: Look;
  /** Why — so the profile can say "you chose this" rather than guess. */
  reason: "chosen" | "wave" | "default";
  /** Which cohort the school's rules put this student in, before their own choice. */
  cohort: Cohort;
  /** Whether the age alone would have put this student in the wave. */
  inWave: boolean;
};

/** Whether this student's age is one where phone usage is worth looking at. */
export function isInviteAge(age: number | null | undefined, wave: LookWave = DEFAULT_LOOK_WAVE): boolean {
  return typeof age === "number" && Number.isFinite(age) && age > wave.maxAge && age <= wave.inviteMaxAge;
}

export function phoneShareOf(usage: PhoneUsage | null | undefined): number | null {
  if (!usage || usage.events <= 0) return null;
  return usage.mobileEvents / usage.events;
}

export function resolveLook(input: {
  age: number | null | undefined;
  choice: Look | null | undefined;
  wave?: LookWave;
  usage?: PhoneUsage | null;
}): LookDecision {
  const wave = input.wave ?? DEFAULT_LOOK_WAVE;
  const age = typeof input.age === "number" && Number.isFinite(input.age) ? input.age : null;
  const inWave = age === null ? wave.includeUnknownAge : age <= wave.maxAge;

  let cohort: Cohort = "classic";
  if (inWave) {
    cohort = "wave";
  } else if (isInviteAge(age, wave)) {
    const share = phoneShareOf(input.usage);
    if (share !== null && (input.usage?.events ?? 0) >= wave.inviteMinEvents && share >= wave.invitePhoneShare) {
      cohort = "invited";
    }
  }

  if (input.choice) return { look: input.choice, reason: "chosen", cohort, inWave };
  if (cohort === "wave") return { look: "youth", reason: "wave", cohort, inWave };
  return { look: "classic", reason: "default", cohort, inWave };
}

/**
 * When the new look first reached students. An "announce" ("we gave the app a
 * fresh look") only makes sense to someone who knew the OLD one — a student who
 * joined after this date has only ever seen the new look, so there is nothing
 * to announce, and on a first visit they are already busy with the welcome
 * tour. They simply have the new look, quietly.
 */
export const NEW_LOOK_LAUNCH_AT = new Date("2026-10-05T00:00:00Z");

/** An invitation waits until a student has found their feet. */
export const INVITE_MIN_ACCOUNT_DAYS = 7;

/**
 * Whether Becca should say something, and what. Only ever for a student who has
 * not been told before, and only for the cohorts it is about — a classic-cohort
 * student is never interrupted, and anyone who already picked a look themselves
 * has already answered the question.
 *
 * It is a gentle banner, never a modal (see components/moment/NewLookMoment.tsx),
 * and these rules are the other half of keeping it out of the way: nobody on
 * their first days gets it, so it can never join the welcome tour's pile-up.
 */
export function promptFor(
  decision: LookDecision,
  promptedBefore: boolean,
  student?: { createdAt: Date | null; now?: Date },
): "announce" | "invite" | null {
  if (promptedBefore || decision.reason === "chosen") return null;

  const created = student?.createdAt ?? null;
  const now = student?.now ?? new Date();
  const accountDays = created ? (now.getTime() - created.getTime()) / 86_400_000 : null;

  if (decision.cohort === "wave") {
    // Joined after launch → never knew the old look. Unknown join date → say nothing rather than guess.
    return created && created < NEW_LOOK_LAUNCH_AT ? "announce" : null;
  }
  if (decision.cohort === "invited") {
    return accountDays !== null && accountDays >= INVITE_MIN_ACCOUNT_DAYS ? "invite" : null;
  }
  return null;
}
