import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK_WAVE, parseLookChoice, parseLookWave, promptFor, resolveLook } from "@/lib/youth-look";

describe("resolveLook", () => {
  it("puts every student on the new look regardless of age, saved choice, or rollout wave", () => {
    expect(resolveLook({ age: 16, choice: null })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: 52, choice: "classic" })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: null, choice: null })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: undefined, choice: null }).look).toBe("youth");
    expect(resolveLook({ age: Number.NaN, choice: null }).look).toBe("youth");
  });

  it("retains parsing of legacy rollout settings without letting them split the student experience", () => {
    const wave = { ...DEFAULT_LOOK_WAVE, includeUnknownAge: true };
    expect(resolveLook({ age: null, choice: "classic", wave }).look).toBe("youth");
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
  it("never prompts the same student twice", () => {
    expect(promptFor(resolveLook({ age: 17, choice: null }), true)).toBeNull();
    expect(promptFor(resolveLook({ age: 52, choice: "classic" }), true)).toBeNull();
  });

  it("announces the universal experience rather than offering an age-based choice", () => {
    expect(promptFor(resolveLook({ age: 52, choice: "classic" }), false)).toBe("announce");
  });
});
