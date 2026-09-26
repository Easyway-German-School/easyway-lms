import { describe, expect, it } from "vitest";
import { formatNaira, nairaInWords } from "./money";

describe("nairaInWords", () => {
  it("matches the wording on the school's own invoice", () => {
    expect(nairaInWords(210_000)).toBe("Two Hundred and Ten Thousand Naira Only");
  });

  it("writes every fee this centre actually charges", () => {
    expect(nairaInWords(160_000)).toBe("One Hundred and Sixty Thousand Naira Only");
    expect(nairaInWords(157_500)).toBe("One Hundred and Fifty-Seven Thousand Five Hundred Naira Only");
    expect(nairaInWords(52_500)).toBe("Fifty-Two Thousand Five Hundred Naira Only");
    expect(nairaInWords(192_500)).toBe("One Hundred and Ninety-Two Thousand Five Hundred Naira Only");
  });

  it("puts 'and' before a trailing sub-hundred, and handles the edges", () => {
    expect(nairaInWords(1_050)).toBe("One Thousand and Fifty Naira Only");
    expect(nairaInWords(1_000_000)).toBe("One Million Naira Only");
    expect(nairaInWords(0)).toBe("Zero Naira Only");
    expect(nairaInWords(19)).toBe("Nineteen Naira Only");
  });

  it("refuses a fractional or negative amount instead of guessing", () => {
    expect(() => nairaInWords(10.5)).toThrow();
    expect(() => nairaInWords(-1)).toThrow();
  });
});

describe("formatNaira", () => {
  it("groups thousands", () => {
    expect(formatNaira(210_000)).toBe("₦210,000");
  });
});
