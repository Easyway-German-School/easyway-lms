import { describe, expect, it } from "vitest";
import { buildJourney, estimateArrival } from "@/lib/germany-journey";

describe("German journey level positioning", () => {
  it("starts an A2 student at A2 rather than drawing A1 as their level", () => {
    const journey = buildJourney({
      studentName: "A2 learner",
      branchName: "Online",
      currentLevel: "A2",
      targetLevel: "B2",
      registeredAt: new Date("2026-01-01"),
      registrationPaid: true,
      seatSecured: true,
      classesStartedAt: new Date("2026-01-05"),
      levelsCompleted: ["A1"],
      claimedStages: {},
      now: new Date("2026-01-10"),
    });

    expect(journey.currentLevel).toBe("A2");
    expect(journey.stages.some((stage) => stage.id === "level:A1")).toBe(false);
    expect(journey.stages.some((stage) => stage.id === "level:A2")).toBe(true);
  });
});

describe("Arrival estimate keeps the level date honest", () => {
  it("does not fold paperwork months into the date next to 'N months of teaching'", () => {
    // An A1 student who has not started classes yet, aiming for B2, on a goal
    // with a long paperwork allowance (settle: 8 months) — the exact shape
    // that used to read "4 levels to B2 · about 8 months of teaching" right
    // next to a date 16 months away.
    const estimate = estimateArrival({
      currentLevel: "A1",
      targetLevel: "B2",
      countdown: null,
      paperworkMonths: 8,
      now: new Date("2026-08-27"),
    });

    expect(estimate.monthsOfTeaching).toBe(8);
    expect(estimate.levelsRemaining).toBe(4);
    // Teaching alone: 8 months from August 2026.
    expect(estimate.levelLabel).toBe("April 2027");
    // Germany, with paperwork on top, stays a distinct and later figure.
    expect(estimate.label).toBe("December 2027");
    expect(new Date(estimate.levelDate!).getTime()).toBeLessThan(new Date(estimate.date!).getTime());
  });

  it("keeps a level exactly 8 weeks regardless of which calendar months it spans", async () => {
    const { buildCountdown } = await import("@/lib/germany-journey");
    const augustStart = buildCountdown("A1", new Date("2026-08-01"), { now: new Date("2026-08-15") });
    const februaryStart = buildCountdown("A1", new Date("2026-02-01"), { now: new Date("2026-02-15") });

    expect(augustStart.weeksTotal).toBe(8);
    expect(februaryStart.weeksTotal).toBe(8);
  });
});