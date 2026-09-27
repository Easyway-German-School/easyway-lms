import { describe, expect, it } from "vitest";
import { isPlausibleDateOfBirth } from "./booking";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe("isPlausibleDateOfBirth", () => {
  it("accepts a plausible adult date of birth", () => {
    expect(isPlausibleDateOfBirth(yearsAgo(25))).toBe(true);
  });

  it("rejects garbage input instead of silently storing an Invalid Date", () => {
    expect(isPlausibleDateOfBirth("not-a-date")).toBe(false);
    expect(isPlausibleDateOfBirth("")).toBe(false);
  });

  it("rejects someone implausibly young or old", () => {
    expect(isPlausibleDateOfBirth(yearsAgo(1))).toBe(false);
    expect(isPlausibleDateOfBirth(yearsAgo(150))).toBe(false);
  });

  it("rejects a date of birth in the future", () => {
    expect(isPlausibleDateOfBirth(yearsAgo(-1))).toBe(false);
  });
});
