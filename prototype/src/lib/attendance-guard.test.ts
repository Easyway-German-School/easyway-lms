import { describe, expect, it } from "vitest";
import { classesHaveBegun, explicitStatus } from "./attendance-guard";

const created = new Date("2026-09-10T10:00:00Z");
const october = { admission: { batch: "October" }, createdAt: created };
// Matches the school's real October: A1 opens the 5th, A2–B2 the 12th.
const overrides = { "2026-10:A1": 5, "2026-10:A2": 12 };

describe("classesHaveBegun", () => {
  it("is false for an October student on a September day", () => {
    expect(classesHaveBegun({ ...october, level: "A1" }, new Date("2026-09-30T00:00:00Z"))).toBe(false);
  });

  it("is false on Oct 1 when A1 opens Oct 5", () => {
    expect(classesHaveBegun({ ...october, level: "A1" }, new Date("2026-10-01T00:00:00Z"), overrides)).toBe(false);
  });

  it("opens A1 on the 5th but A2 not until the 12th", () => {
    const day = new Date("2026-10-06T00:00:00Z");
    expect(classesHaveBegun({ ...october, level: "A1" }, day, overrides)).toBe(true);
    expect(classesHaveBegun({ ...october, level: "A2" }, day, overrides)).toBe(false);
  });

  it("lets an admin-confirmed start day override the batch", () => {
    expect(
      classesHaveBegun(
        { ...october, level: "A1", classesStartedAt: new Date("2026-09-20T00:00:00Z") },
        new Date("2026-09-25T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("allows legacy rows with no batch signal", () => {
    expect(classesHaveBegun({ admission: {}, createdAt: created }, new Date("2026-09-30T00:00:00Z"))).toBe(true);
  });
});

describe("explicitStatus", () => {
  it("accepts only the three real statuses", () => {
    expect(explicitStatus("absent")).toBe("absent");
    expect(explicitStatus("late")).toBe("late");
    expect(explicitStatus(undefined)).toBeNull();
    expect(explicitStatus("")).toBeNull();
    expect(explicitStatus(false)).toBeNull();
  });
});
