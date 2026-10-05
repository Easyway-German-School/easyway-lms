import { describe, expect, it } from "vitest";

import { amountInWords, isEasywayBrand, ordinalDate } from "./pdf-brand";

describe("amountInWords", () => {
  it("writes the amount out the way the paper receipt book does", () => {
    expect(amountInWords(405000)).toBe("Four hundred and five thousand Naira only");
    expect(amountInWords(150000)).toBe("One hundred and fifty thousand Naira only");
    expect(amountInWords(5000)).toBe("Five thousand Naira only");
    expect(amountInWords(580000)).toBe("Five hundred and eighty thousand Naira only");
  });

  it("handles small, round and large figures", () => {
    expect(amountInWords(0)).toBe("Zero Naira only");
    expect(amountInWords(21)).toBe("Twenty-one Naira only");
    expect(amountInWords(1_000_000)).toBe("One million Naira only");
    expect(amountInWords(1_250_050)).toBe("One million two hundred and fifty thousand and fifty Naira only");
  });

  it("names a foreign currency by code", () => {
    expect(amountInWords(300, "usd")).toBe("Three hundred USD only");
  });
});

describe("ordinalDate", () => {
  it("matches the school's letter style", () => {
    expect(ordinalDate(new Date(2026, 9, 2))).toBe("2nd of October, 2026");
    expect(ordinalDate(new Date(2026, 8, 1))).toBe("1st of September, 2026");
    expect(ordinalDate(new Date(2026, 8, 3))).toBe("3rd of September, 2026");
  });

  it("does not misread the teens", () => {
    expect(ordinalDate(new Date(2026, 8, 11))).toBe("11th of September, 2026");
    expect(ordinalDate(new Date(2026, 8, 12))).toBe("12th of September, 2026");
    expect(ordinalDate(new Date(2026, 8, 13))).toBe("13th of September, 2026");
    expect(ordinalDate(new Date(2026, 8, 22))).toBe("22nd of September, 2026");
  });
});

describe("isEasywayBrand", () => {
  it("keeps Easyway's stamp and signature off other schools' documents", () => {
    expect(isEasywayBrand(undefined)).toBe(true);
    expect(isEasywayBrand("Easyway Language School")).toBe(true);
    expect(isEasywayBrand("Easy Way German Language School")).toBe(true);
    expect(isEasywayBrand("Sprachhaus Berlin")).toBe(false);
  });
});
