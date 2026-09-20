import { describe, expect, it } from "vitest";
import { ageBandOf, ageFromDob, dobOfStudent, summariseAges } from "@/lib/age-bands";

const NOW = new Date("2026-09-20T12:00:00Z");

describe("ageFromDob", () => {
  it("counts whole years and respects an upcoming birthday", () => {
    expect(ageFromDob("2000-09-20", NOW)).toBe(26);
    expect(ageFromDob("2000-09-21", NOW)).toBe(25);
    expect(ageFromDob(new Date("1984-04-08T23:00:00Z"), NOW)).toBe(42);
  });

  it("refuses dates that cannot be a learner", () => {
    expect(ageFromDob(null, NOW)).toBeNull();
    expect(ageFromDob("not a date", NOW)).toBeNull();
    expect(ageFromDob("2030-01-01", NOW)).toBeNull();
    expect(ageFromDob("1900-01-01", NOW)).toBeNull();
    expect(ageFromDob("2025-01-01", NOW)).toBeNull();
  });
});

describe("ageBandOf", () => {
  it("puts the edges in the right band", () => {
    expect(ageBandOf(17)).toBe("under18");
    expect(ageBandOf(18)).toBe("18-24");
    expect(ageBandOf(34)).toBe("25-34");
    expect(ageBandOf(35)).toBe("35-44");
    expect(ageBandOf(54)).toBe("45-54");
    expect(ageBandOf(55)).toBe("55+");
    expect(ageBandOf(null)).toBeNull();
  });
});

describe("dobOfStudent", () => {
  it("prefers the typed column, falls back to a DD/MM/YYYY admission string", () => {
    const typed = new Date("1990-02-24T00:00:00Z");
    expect(dobOfStudent({ dateOfBirth: typed }, {})).toEqual(typed);
    const legacy = dobOfStudent(null, { dob: "24/02/1990" });
    expect(legacy?.toISOString().slice(0, 10)).toBe("1990-02-24");
    expect(dobOfStudent(null, {})).toBeNull();
  });
});

describe("summariseAges", () => {
  it("bands, averages and flags the older learners", () => {
    const summary = summariseAges([
      { age: 20, attendanceRate: 0.9, progressPercent: 80 },
      { age: 22, attendanceRate: 0.7, progressPercent: 60 },
      { age: 50, attendanceRate: 0.4, progressPercent: 20 },
      { age: 61, attendanceRate: null, progressPercent: null },
      { age: null, attendanceRate: 1, progressPercent: 100 },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.known).toBe(4);
    expect(summary.unknown).toBe(1);
    expect(summary.olderCount).toBe(2);
    expect(summary.olderSharePercent).toBe(50);

    const young = summary.bands.find((b) => b.key === "18-24")!;
    expect(young.count).toBe(2);
    expect(young.avgAttendancePercent).toBe(80);
    expect(young.avgProgressPercent).toBe(70);

    const oldest = summary.bands.find((b) => b.key === "55+")!;
    expect(oldest.count).toBe(1);
    expect(oldest.avgAttendancePercent).toBeNull();
  });

  it("is safe with no data at all", () => {
    const summary = summariseAges([]);
    expect(summary.known).toBe(0);
    expect(summary.averageAge).toBeNull();
    expect(summary.bands.every((b) => b.count === 0 && b.sharePercent === 0)).toBe(true);
  });
});
