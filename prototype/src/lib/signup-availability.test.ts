import { describe, expect, it } from "vitest";
import {
  parseClosedSignupSlots,
  signupSlotIsClosed,
  validateClosedSignupSlots,
  type ClosedSignupSlot,
} from "@/lib/signup-availability";

describe("closed signup slots", () => {
  const slot: ClosedSignupSlot = {
    batch: "October",
    year: new Date().getFullYear(),
    level: "A1",
    sessionSlot: "morning",
  };

  it("closes only the selected month, year, level, and session", () => {
    expect(signupSlotIsClosed([slot], slot)).toBe(true);
    expect(signupSlotIsClosed([slot], { ...slot, sessionSlot: "evening" })).toBe(false);
    expect(signupSlotIsClosed([slot], { ...slot, level: "A2" })).toBe(false);
    expect(signupSlotIsClosed([slot], { ...slot, year: slot.year + 1 })).toBe(false);
  });

  it("normalizes validated values and ignores malformed stored entries", () => {
    expect(validateClosedSignupSlots([slot])).toEqual([slot]);
    expect(validateClosedSignupSlots([{ ...slot, sessionSlot: "late" }])).toBeNull();
    expect(parseClosedSignupSlots([{ ...slot, batch: "Smarch" }])).toEqual([]);
  });
});
