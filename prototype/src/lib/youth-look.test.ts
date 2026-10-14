import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK_WAVE, parseLookChoice, parseLookWave, promptFor, resolveLook } from "@/lib/youth-look";

describe("resolveLook", () => {
  it("puts every student on the new look by default, regardless of age", () => {
    expect(resolveLook({ age: 16, choice: null })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: 24, choice: null }).look).toBe("youth");
    expect(resolveLook({ age: 25, choice: null }).look).toBe("youth");
    expect(resolveLook({ age: 52, choice: null }).look).toBe("youth");
  });

  it("does not need an age at all — a student we cannot work out still gets the new look", () => {
    expect(resolveLook({ age: null, choice: null }).look).toBe("youth");
    expect(resolveLook({ age: undefined, choice: null }).look).toBe("youth");
    expect(resolveLook({ age: Number.NaN, choice: null }).look).toBe("youth");
  });

  it("ignores a wave setting — the age-based rollout is retired", () => {
    const wave = { ...DEFAULT_LOOK_WAVE, maxAge: 0, includeUnknownAge: false };
    expect(resolveLook({ age: 90, choice: null, wave }).look).toBe("youth");
    expect(resolveLook({ age: null, choice: null, wave }).look).toBe("youth");
  });

  it("always honours the student's own choice, in both directions", () => {
    expect(resolveLook({ age: 60, choice: "youth" })).toEqual({ look: "youth", reason: "chosen", cohort: "wave", inWave: true });
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
  const young = resolveLook({ age: 17, choice: null });
  const older = resolveLook({ age: 29, choice: null });
  const senior = resolveLook({ age: 52, choice: null });
  const noBirthDate = resolveLook({ age: null, choice: null });

  it("announces the new look to everyone, once, regardless of age", () => {
    expect(promptFor(young, false)).toBe("announce");
    expect(promptFor(older, false)).toBe("announce");
    expect(promptFor(senior, false)).toBe("announce");
    expect(promptFor(noBirthDate, false)).toBe("announce");
  });

  it("never prompts the same student twice", () => {
    expect(promptFor(young, true)).toBeNull();
    expect(promptFor(older, true)).toBeNull();
  });

  it("never prompts someone who already picked a look themselves", () => {
    expect(promptFor(resolveLook({ age: 17, choice: "classic" }), false)).toBeNull();
    expect(promptFor(resolveLook({ age: 52, choice: "youth" }), false)).toBeNull();
  });
});
