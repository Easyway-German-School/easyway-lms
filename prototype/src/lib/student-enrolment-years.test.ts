import { describe, expect, it } from "vitest";
import { enrolmentYearOptions } from "./student-enrolment-years";

describe("enrolmentYearOptions", () => {
  it("includes upcoming years as well as the existing history window", () => {
    expect(enrolmentYearOptions(new Date(2026, 9, 29))).toEqual([
      2031, 2030, 2029, 2028, 2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020,
    ]);
  });

  it("advances the range automatically when the calendar year changes", () => {
    expect(enrolmentYearOptions(new Date(2027, 0, 1))[0]).toBe(2032);
    expect(enrolmentYearOptions(new Date(2027, 0, 1))).toContain(2027);
  });
});
