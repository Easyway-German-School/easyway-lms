import { describe, expect, it } from "vitest";
import { autoProgressionDecision } from "./auto-progression";
import { nextPlacement } from "./graduation";

describe("automatic progression timing", () => {
  const startedAt = new Date("2026-09-01T12:00:00Z");

  it("waits for the full two-calendar-month weekday course window", () => {
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "student",
        now: new Date("2026-10-31T23:59:59Z"),
      }).eligible,
    ).toBe(false);
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "attendance",
        now: new Date("2026-11-01T00:00:00Z"),
      }),
    ).toEqual({ eligible: true, completedAt: new Date("2026-11-01T00:00:00.000Z") });
  });

  it("waits for the full three-calendar-month weekend course window", () => {
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "attendance",
        sessionSlot: "weekend",
        now: new Date("2026-11-30T23:59:59Z"),
      }).eligible,
    ).toBe(false);
    expect(
      autoProgressionDecision({
        startedAt,
        confirmedVia: "attendance",
        sessionSlot: "weekend",
        now: new Date("2026-12-01T00:00:00Z"),
      }).eligible,
    ).toBe(true);
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

  it("places a late-start September learner into the first level intake after the course window", () => {
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
