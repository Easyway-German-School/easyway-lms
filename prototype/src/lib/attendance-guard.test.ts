import { describe, expect, it } from "vitest";
import { classesHaveBegun, explicitStatus } from "./attendance-guard";

const created = new Date("2026-09-10T10:00:00Z");

describe("classesHaveBegun", () => {
  it("is false for an October student on a September day", () => {
    expect(
      classesHaveBegun({ admission: { batch: "October" }, createdAt: created }, new Date("2026-09-30T00:00:00")),
    ).toBe(false);
  });

  it("is true once the batch month opens", () => {
    expect(
      classesHaveBegun({ admission: { batch: "October" }, createdAt: created }, new Date("2026-10-02T00:00:00")),
    ).toBe(true);
  });

  it("lets an admin-confirmed start day override the batch", () => {
    expect(
      classesHaveBegun(
        { admission: { batch: "October" }, createdAt: created, classesStartedAt: new Date("2026-09-20T00:00:00") },
        new Date("2026-09-25T00:00:00"),
      ),
    ).toBe(true);
  });

  it("honours the explicit year of a student the office moved to a later batch", () => {
    // Registered a year ago, moved to October 2026. Without the year, "October"
    // resolves to the October that already happened and the register would mark
    // them absent for September classes they were never in.
    const registeredLongAgo = new Date("2025-08-12T10:00:00Z");
    expect(
      classesHaveBegun(
        { admission: { batch: "October", batchYear: 2026 }, createdAt: registeredLongAgo },
        new Date("2026-09-30T00:00:00"),
      ),
    ).toBe(false);
    expect(
      classesHaveBegun(
        { admission: { batch: "October", batchYear: 2026 }, createdAt: registeredLongAgo },
        new Date("2026-10-06T00:00:00"),
      ),
    ).toBe(true);
  });

  it("allows legacy rows with no batch signal", () => {
    expect(classesHaveBegun({ admission: {}, createdAt: created }, new Date("2026-09-30T00:00:00"))).toBe(true);
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
