import { describe as suite, expect, it } from "vitest";

import { normalizeNigerianPhone } from "./sms";

/**
 * Nigerian phone numbers arrive in whatever shape a person typed on a form.
 * Termii needs a bare "234XXXXXXXXXX" with no leading '+' — get this wrong
 * and every SMS in that shape is a wasted, billed send to a dead number.
 */
suite("normalizeNigerianPhone", () => {
  it("accepts a local 0-prefixed number", () => {
    expect(normalizeNigerianPhone("08031234567")).toBe("2348031234567");
  });

  it("accepts an already-international number with a leading +", () => {
    expect(normalizeNigerianPhone("+2348031234567")).toBe("2348031234567");
  });

  it("accepts an international number with no +", () => {
    expect(normalizeNigerianPhone("2348031234567")).toBe("2348031234567");
  });

  it("strips spaces and dashes before parsing", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("2348031234567");
    expect(normalizeNigerianPhone("0803-123-4567")).toBe("2348031234567");
  });

  it("accepts a bare 10-digit number with the leading 0 already stripped", () => {
    expect(normalizeNigerianPhone("8031234567")).toBe("2348031234567");
  });

  it("returns null for empty, null, or undefined input", () => {
    expect(normalizeNigerianPhone("")).toBeNull();
    expect(normalizeNigerianPhone(null)).toBeNull();
    expect(normalizeNigerianPhone(undefined)).toBeNull();
  });

  it("returns null for a number that is too short or too long to be confident about", () => {
    expect(normalizeNigerianPhone("12345")).toBeNull();
    expect(normalizeNigerianPhone("080312345678901")).toBeNull();
  });
});
