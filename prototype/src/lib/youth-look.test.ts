import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK_WAVE, parseLookChoice, parseLookWave, resolveLook } from "@/lib/youth-look";

describe("resolveLook", () => {
  it("puts under-25s on the new look by default", () => {
    expect(resolveLook({ age: 16, choice: null })).toEqual({ look: "youth", reason: "wave", inWave: true });
    expect(resolveLook({ age: 24, choice: null }).look).toBe("youth");
  });

  it("leaves 25 and over on the classic look", () => {
    expect(resolveLook({ age: 25, choice: null })).toEqual({ look: "classic", reason: "default", inWave: false });
    expect(resolveLook({ age: 52, choice: null }).look).toBe("classic");
  });

  it("does not move a student whose age we cannot work out", () => {
    expect(resolveLook({ age: null, choice: null }).look).toBe("classic");
    expect(resolveLook({ age: undefined, choice: null }).look).toBe("classic");
    expect(resolveLook({ age: Number.NaN, choice: null }).look).toBe("classic");
  });

  it("lets a wave include unknown ages when the school says so", () => {
    const wave = { maxAge: 24, includeUnknownAge: true };
    expect(resolveLook({ age: null, choice: null, wave }).look).toBe("youth");
  });

  it("lets the school widen the wave without code", () => {
    const wave = { maxAge: 34, includeUnknownAge: false };
    expect(resolveLook({ age: 30, choice: null, wave }).look).toBe("youth");
    expect(resolveLook({ age: 35, choice: null, wave }).look).toBe("classic");
  });

  it("always honours the student's own choice, in both directions", () => {
    expect(resolveLook({ age: 60, choice: "youth" })).toEqual({ look: "youth", reason: "chosen", inWave: false });
    expect(resolveLook({ age: 15, choice: "classic" })).toEqual({ look: "classic", reason: "chosen", inWave: true });
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
    expect(parseLookWave({ maxAge: 34, includeUnknownAge: true })).toEqual({ maxAge: 34, includeUnknownAge: true });
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
