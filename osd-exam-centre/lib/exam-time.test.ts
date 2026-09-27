import { describe, expect, it } from "vitest";
import { arrivalClock, calendarDaysBetween, formatClock, lagosDateKey } from "./exam-time";

describe("Lagos calendar days", () => {
  it("counts on Lagos dates, not UTC — 23:30 UTC is already tomorrow in Lagos", () => {
    // 2026-10-21 23:30 UTC = 2026-10-22 00:30 Lagos. The exam is on the 29th: 7 days out, not 8.
    expect(lagosDateKey(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
    expect(calendarDaysBetween(new Date("2026-10-21T23:30:00Z"), new Date("2026-10-29T00:00:00+01:00"))).toBe(7);
  });

  it("is negative once the date has passed", () => {
    expect(calendarDaysBetween(new Date("2026-11-02T10:00:00Z"), new Date("2026-10-29T00:00:00+01:00"))).toBe(-4);
  });
});

describe("clock formatting", () => {
  it("formats 12-hour times and rejects junk", () => {
    expect(formatClock("09:00")).toBe("9:00 AM");
    expect(formatClock("13:30")).toBe("1:30 PM");
    expect(formatClock("00:15")).toBe("12:15 AM");
    expect(formatClock("25:00")).toBeNull();
    expect(formatClock(null)).toBeNull();
  });

  it("derives arrival from the manual's 60-minute rule", () => {
    expect(arrivalClock("09:00", 60)).toBe("8:00 AM");
    expect(arrivalClock("09:30", 60)).toBe("8:30 AM");
    expect(arrivalClock(null, 60)).toBeNull();
  });
});
