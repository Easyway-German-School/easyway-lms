import { describe, expect, it } from "vitest";
import { isPlausibleIdExpiry } from "./booking";

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

describe("isPlausibleIdExpiry", () => {
  it("accepts an ID that expires in the future", () => {
    expect(isPlausibleIdExpiry(daysFromNow(365))).toBe(true);
  });

  it("rejects an already-expired ID", () => {
    expect(isPlausibleIdExpiry(daysFromNow(-1))).toBe(false);
  });

  it("rejects garbage input instead of silently storing an Invalid Date", () => {
    expect(isPlausibleIdExpiry("not-a-date")).toBe(false);
    expect(isPlausibleIdExpiry("")).toBe(false);
  });
});
