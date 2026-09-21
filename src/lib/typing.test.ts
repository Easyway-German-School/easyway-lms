import { describe, expect, it } from "vitest";
import {
  TYPING_LIVE_MS,
  TYPING_PING_EVERY_MS,
  describeTypers,
  describeTypersShort,
  firstName,
  typerInitials,
} from "./typing";

describe("describeTypers", () => {
  it("says nothing when nobody is typing", () => {
    expect(describeTypers([])).toBe("");
    expect(describeTypersShort([])).toBe("");
  });

  it("uses singular for one and plural from two", () => {
    expect(describeTypers(["Anna"])).toBe("Anna is typing");
    expect(describeTypers(["Anna", "Ben"])).toBe("Anna and Ben are typing");
  });

  it("names three, then collapses to a count", () => {
    expect(describeTypers(["Anna", "Ben", "Chi"])).toBe("Anna, Ben and Chi are typing");
    expect(describeTypers(["Anna", "Ben", "Chi", "Dayo"])).toBe("Anna, Ben and 2 others are typing");
    expect(describeTypers(["A", "B", "C", "D", "E", "F"])).toBe("A, B and 4 others are typing");
  });

  it("short form fits a list row: at most one name plus a count beyond two", () => {
    expect(describeTypersShort(["Anna", "Ben"])).toBe("Anna and Ben are typing");
    expect(describeTypersShort(["Anna", "Ben", "Chi"])).toBe("Anna and 2 others are typing");
  });

  it("ignores blank names rather than printing a gap", () => {
    expect(describeTypers(["Anna", ""])).toBe("Anna is typing");
  });
});

describe("firstName / typerInitials", () => {
  it("takes the first word and never returns empty", () => {
    expect(firstName("Anna Okafor")).toBe("Anna");
    expect(firstName("  Ben  ")).toBe("Ben");
    expect(firstName("")).toBe("Someone");
    expect(firstName(null)).toBe("Someone");
  });

  it("builds up to two initials", () => {
    expect(typerInitials("Anna Okafor")).toBe("AO");
    expect(typerInitials("Ben")).toBe("B");
    expect(typerInitials("")).toBe("?");
  });
});

describe("timings", () => {
  it("keeps the live window longer than one missed stamp, or the dots would flicker", () => {
    expect(TYPING_LIVE_MS).toBeGreaterThan(TYPING_PING_EVERY_MS * 2);
  });
});
