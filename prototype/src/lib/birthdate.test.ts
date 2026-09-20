import { describe, expect, it } from "vitest";
import { joinDob, splitDob } from "@/lib/birthdate";

const NOW = new Date("2026-09-20T12:00:00Z");

describe("splitDob", () => {
  it("reads ISO and legacy DD/MM/YYYY, and gives up quietly on anything else", () => {
    expect(splitDob("1988-06-14")).toEqual({ day: "14", month: "6", year: "1988" });
    expect(splitDob("1988-06-14T23:00:00.000Z")).toEqual({ day: "14", month: "6", year: "1988" });
    expect(splitDob("04/09/1984")).toEqual({ day: "4", month: "9", year: "1984" });
    expect(splitDob("first of May 1990")).toEqual({ day: "", month: "", year: "" });
    expect(splitDob("")).toEqual({ day: "", month: "", year: "" });
  });
});

describe("joinDob", () => {
  it("builds ISO from three boxes", () => {
    expect(joinDob("14", "6", "1965", NOW)).toBe("1965-06-14");
    expect(joinDob("1", "1", "2001", NOW)).toBe("2001-01-01");
  });

  it("returns blank until every box is usable", () => {
    expect(joinDob("", "6", "1965", NOW)).toBe("");
    expect(joinDob("14", "", "1965", NOW)).toBe("");
    expect(joinDob("14", "6", "196", NOW)).toBe("");
  });

  it("rejects dates that do not exist or cannot be a learner", () => {
    expect(joinDob("31", "2", "2000", NOW)).toBe("");
    expect(joinDob("14", "6", "1899", NOW)).toBe("");
    expect(joinDob("14", "6", "2030", NOW)).toBe("");
    expect(joinDob("14", "6", "0026", NOW)).toBe("");
  });

  it("round-trips with splitDob", () => {
    const p = splitDob("1972-11-03");
    expect(joinDob(p.day, p.month, p.year, NOW)).toBe("1972-11-03");
  });
});
