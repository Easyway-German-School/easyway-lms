import { describe, expect, it } from "vitest";
import { autoProgressionDecision } from "./auto-progression";
import { nextPlacement } from "./graduation";

describe("eight-week automatic progression", () => {
  const startedAt = new Date("2026-09-01T00:00:00Z");

  it("waits for the full 56 days from a confirmed first class", () => {
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "student",
        now: new Date("2026-10-26T00:00:00Z"),
      }).eligible,
    ).toBe(false);
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "attendance",
        now: new Date("2026-10-27T00:00:00Z"),
      }),
    ).toEqual({ eligible: true, completedAt: new Date("2026-10-27T00:00:00Z") });
  });

  it("does not use a batch-assigned future start as proof of attendance", () => {
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "promotion",
        now: new Date("2027-01-01T00:00:00Z"),
      }),
    ).toEqual({ eligible: false, reason: "unconfirmed_start" });
  });

  it("places a late-start September learner into the first level intake after eight weeks", () => {
    const placement = nextPlacement({
      batch: "September",
      registeredAt: new Date("2026-08-01T00:00:00Z"),
      now: new Date("2026-10-27T00:00:00Z"),
      notBefore: new Date("2026-10-27T00:00:00Z"),
      level: "A2",
    });
    expect(placement?.label).toBe("November 2026");
  });
});
