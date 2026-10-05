import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOOK_WAVE,
  isInviteAge,
  parseLookChoice,
  parseLookWave,
  phoneShareOf,
  promptFor,
  resolveLook,
} from "@/lib/youth-look";

describe("resolveLook", () => {
  it("puts under-25s on the new look by default", () => {
    expect(resolveLook({ age: 16, choice: null })).toEqual({ look: "youth", reason: "wave", cohort: "wave", inWave: true });
    expect(resolveLook({ age: 24, choice: null }).look).toBe("youth");
  });

  it("leaves 25 and over on the classic look", () => {
    expect(resolveLook({ age: 25, choice: null })).toEqual({ look: "classic", reason: "default", cohort: "classic", inWave: false });
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
    expect(resolveLook({ age: 60, choice: "youth" })).toEqual({ look: "youth", reason: "chosen", cohort: "classic", inWave: false });
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
    expect(parseLookWave({ maxAge: 30, includeUnknownAge: true, inviteMaxAge: 40, invitePhoneShare: 0.5, inviteMinEvents: 5 })).toEqual({
      maxAge: 30,
      includeUnknownAge: true,
      inviteMaxAge: 40,
      invitePhoneShare: 0.5,
      inviteMinEvents: 5,
    });
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

describe("the invited cohort", () => {
  const phone = { events: 40, mobileEvents: 36 }; // 90% on a phone
  const laptop = { events: 40, mobileEvents: 4 }; // 10%

  it("invites 25–34s who live on their phone, without changing their layout", () => {
    const d = resolveLook({ age: 29, choice: null, usage: phone });
    expect(d).toEqual({ look: "classic", reason: "default", cohort: "invited", inWave: false });
  });

  it("does not invite a 25–34 who mostly uses a laptop", () => {
    expect(resolveLook({ age: 29, choice: null, usage: laptop }).cohort).toBe("classic");
  });

  it("does not trust a phone share built on a handful of events", () => {
    expect(resolveLook({ age: 29, choice: null, usage: { events: 3, mobileEvents: 3 } }).cohort).toBe("classic");
  });

  it("never invites anyone with no usage on record", () => {
    expect(resolveLook({ age: 29, choice: null, usage: null }).cohort).toBe("classic");
    expect(resolveLook({ age: 29, choice: null }).cohort).toBe("classic");
  });

  it("never invites 35 and over, however phone-heavy", () => {
    expect(resolveLook({ age: 35, choice: null, usage: phone }).cohort).toBe("classic");
    expect(resolveLook({ age: 58, choice: null, usage: phone }).cohort).toBe("classic");
  });

  it("never invites an unknown age", () => {
    expect(resolveLook({ age: null, choice: null, usage: phone }).cohort).toBe("classic");
  });

  it("knows which ages are worth measuring", () => {
    expect(isInviteAge(24)).toBe(false);
    expect(isInviteAge(25)).toBe(true);
    expect(isInviteAge(34)).toBe(true);
    expect(isInviteAge(35)).toBe(false);
    expect(isInviteAge(null)).toBe(false);
  });

  it("measures phone share", () => {
    expect(phoneShareOf(phone)).toBeCloseTo(0.9);
    expect(phoneShareOf({ events: 0, mobileEvents: 0 })).toBeNull();
    expect(phoneShareOf(null)).toBeNull();
  });

  it("keeps invitations from reaching down into the wave", () => {
    expect(parseLookWave({ maxAge: 30, inviteMaxAge: 20 }).inviteMaxAge).toBe(30);
  });
});

describe("promptFor", () => {
  const wave = resolveLook({ age: 17, choice: null });
  const invited = resolveLook({ age: 29, choice: null, usage: { events: 50, mobileEvents: 50 } });
  const classic = resolveLook({ age: 52, choice: null });

  it("announces to the wave and invites the invited, once", () => {
    expect(promptFor(wave, false)).toBe("announce");
    expect(promptFor(invited, false)).toBe("invite");
  });

  it("never prompts the same student twice", () => {
    expect(promptFor(wave, true)).toBeNull();
    expect(promptFor(invited, true)).toBeNull();
  });

  it("never interrupts the classic cohort", () => {
    expect(promptFor(classic, false)).toBeNull();
  });

  it("never prompts someone who already picked a look themselves", () => {
    expect(promptFor(resolveLook({ age: 17, choice: "classic" }), false)).toBeNull();
    expect(promptFor(resolveLook({ age: 52, choice: "youth" }), false)).toBeNull();
  });
});
