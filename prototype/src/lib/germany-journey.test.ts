import { describe, expect, it } from "vitest";
import { buildJourney } from "@/lib/germany-journey";

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