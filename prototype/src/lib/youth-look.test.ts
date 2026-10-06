import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK_WAVE, parseLookChoice, parseLookWave, promptFor, resolveLook } from "@/lib/youth-look";

describe("resolveLook", () => {
  it("puts under-25s on the new look by default", () => {
    expect(resolveLook({ age: 16, choice: null })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: 24, choice: null }).look).toBe("youth");
  });

  it("leaves 25 and over on the classic look", () => {
    expect(resolveLook({ age: 25, choice: null })).toEqual({ look: "classic", reason: "default", cohort: "invited", inWave: false });
    expect(resolveLook({ age: 52, choice: null }).look).toBe("classic");
  });

  it("does not move a student whose age we cannot work out", () => {
    expect(resolveLook({ age: null, choice: null }).look).toBe("classic");
    expect(resolveLook({ age: undefined, choice: null }).look).toBe("classic");
    expect(resolveLook({ age: Number.NaN, choice: null }).look).toBe("classic");
  });

  it("lets a wave include unknown ages when the school says so", () => {
    const wave = { ...DEFAULT_LOOK_WAVE, includeUnknownAge: true };
    expect(resolveLook({ age: null, choice: null, wave }).look).toBe("youth");
  });

  it("lets the school widen the wave without code", () => {
    const wave = { ...DEFAULT_LOOK_WAVE, maxAge: 34 };
    expect(resolveLook({ age: 30, choice: null, wave }).look).toBe("youth");
    expect(resolveLook({ age: 35, choice: null, wave }).look).toBe("classic");
  });

  it("always honours the student's own choice, in both directions", () => {
    expect(resolveLook({ age: 60, choice: "youth" })).toEqual({ look: "youth", reason: "chosen", cohort: "invited", inWave: false });
    expect(resolveLook({ age: 15, choice: "classic" })).toEqual({ look: "classic", reason: "chosen", cohort: "wave", inWave: true });
    expect(resolveLook({ age: null, choice: "youth" }).look).toBe("youth");
  });
});

describe("parseLookWave", () => {
  it("falls back to wave one for anything unreadable", () => {
    expect(parseLookWave(undefined)).toEqual(DEFAULT_LOOK_WAVE);
    expect(parseLookWave(null)).toEqual(DEFAULT_LOOK_WAVE);
    expect(parseLookWave("everyone")).toEqual(DEFAULT_LOOK_WAVE);
    expect(parseLookWave({ maxAge: "old" })).toEqual(DEFAULT_LOOK_WAVE);
  });

  it("reads a well-formed row", () => {
    expect(parseLookWave({ maxAge: 30, includeUnknownAge: true })).toEqual({ maxAge: 30, includeUnknownAge: true });
  });

  it("ignores the retired phone-usage invitation rules an older save may carry", () => {
    expect(parseLookWave({ maxAge: 24, includeUnknownAge: false, inviteMaxAge: 34, invitePhoneShare: 0.6, inviteMinEvents: 10 })).toEqual(
      DEFAULT_LOOK_WAVE,
    );
  });

  it("clamps an absurd age and rounds a fractional one", () => {
    expect(parseLookWave({ maxAge: 9000 }).maxAge).toBe(120);
    expect(parseLookWave({ maxAge: -5 }).maxAge).toBe(0);
    expect(parseLookWave({ maxAge: 24.6 }).maxAge).toBe(25);
  });
});

describe("parseLookChoice", () => {
  it("accepts only the two known looks", () => {
    expect(parseLookChoice("youth")).toBe("youth");
    expect(parseLookChoice("classic")).toBe("classic");
    expect(parseLookChoice("neon")).toBeNull();
    expect(parseLookChoice(null)).toBeNull();
    expect(parseLookChoice(1)).toBeNull();
  });
});

describe("promptFor", () => {
  const wave = resolveLook({ age: 17, choice: null });
  const older = resolveLook({ age: 29, choice: null });
  const senior = resolveLook({ age: 52, choice: null });
  const noBirthDate = resolveLook({ age: null, choice: null });
  const now = new Date("2026-10-06T08:00:00Z");
  const oldTimer = { createdAt: new Date("2026-08-01T00:00:00Z"), now };
  const joinedAfterLaunch = { createdAt: new Date("2026-10-05T09:00:00Z"), now };

  it("announces to existing wave students and offers the choice to everyone else, once", () => {
    expect(promptFor(wave, false, oldTimer)).toBe("announce");
    expect(promptFor(older, false, oldTimer)).toBe("invite");
  });

  it("offers the choice at any age, and when no birth date is on file", () => {
    expect(promptFor(senior, false, oldTimer)).toBe("invite");
    expect(promptFor(noBirthDate, false, oldTimer)).toBe("invite");
  });

  it("never prompts the same student twice", () => {
    expect(promptFor(wave, true, oldTimer)).toBeNull();
    expect(promptFor(older, true, oldTimer)).toBeNull();
  });

  it("never prompts someone who already picked a look themselves", () => {
    expect(promptFor(resolveLook({ age: 17, choice: "classic" }), false, oldTimer)).toBeNull();
    expect(promptFor(resolveLook({ age: 52, choice: "youth" }), false, oldTimer)).toBeNull();
  });

  it("does not announce a 'fresh look' to a student who joined after launch — they never knew the old one", () => {
    expect(promptFor(wave, false, joinedAfterLaunch)).toBeNull();
  });

  it("does not guess when the join date is unknown", () => {
    expect(promptFor(wave, false)).toBeNull();
    expect(promptFor(wave, false, { createdAt: null })).toBeNull();
    expect(promptFor(older, false)).toBeNull();
  });

  it("holds an offer back only for a student's very first day or two", () => {
    expect(promptFor(older, false, { createdAt: new Date("2026-10-05T12:00:00Z"), now })).toBeNull();
    expect(promptFor(older, false, { createdAt: new Date("2026-10-03T00:00:00Z"), now })).toBe("invite");
  });
});
