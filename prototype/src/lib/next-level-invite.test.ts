import { describe, expect, it } from "vitest";
import { buildInvite } from "./next-level-invite";
import { buildRecap } from "./next-level-journey";
import type { JourneyPayload } from "./next-level-journey-server";

function journey(state: "ended" | "midway"): JourneyPayload {
  const recap = buildRecap({
    state,
    firstName: "Ada",
    finishedLevel: "A1",
    targetLevel: "A2",
    classesAttended: 27,
    classesMarked: 30,
    lateCount: 1,
    gradeAverages: { speaking: 88, essay: 61 },
    gradesCount: 4,
    videosCompleted: 12,
    assignmentsSubmitted: 4,
    gamesPlayed: 0,
    bestGameStreak: 0,
    archetype: "night_owl",
    peakHour: 21,
    peakWeekday: 2,
    longestStreak: 9,
    totalMinutes: 600,
    activeDays: 30,
  });
  return {
    audience: { state, finishedLevel: "A1", targetLevel: "A2" },
    portalOpen: true,
    recap,
    offer: {
      tuitionFee: 150000,
      requiredDeposit: 90000,
      sellableOnline: true,
      branchName: "Lagos",
      weeksOfTeaching: 8,
      sessionMonths: 2,
      priorOwed: 0,
      seat: "none",
      opensOn: null,
      opensLabel: "Monday, 12 October",
      payHref: null,
    },
    intent: null,
    prefill: { name: "Ada", phone: "", parentPhone: "", sessionSlot: "morning", deliveryMode: "physical" },
  };
}

describe("buildInvite", () => {
  it("writes a personal email from the student's own numbers", () => {
    const invite = buildInvite(journey("ended"), "Ada Okafor");
    expect(invite.title).toBe("Ada, your A2 plan is ready");
    expect(invite.html).toContain("Hallo Ada,");
    expect(invite.html).toContain("27");
    expect(invite.html).toContain("Monday, 12 October");
    expect(invite.html).toContain("/next-level");
    expect(invite.emailBody).toContain("See your A2 plan");
  });

  it("never says the level is done when it is only a month in", () => {
    const invite = buildInvite(journey("midway"), "Ada Okafor");
    expect(invite.title).toMatch(/month into A1/);
    expect(invite.message).not.toMatch(/finished A1/);
  });

  it("escapes anything that came from a name", () => {
    const invite = buildInvite(journey("ended"), "<script>alert(1)</script> Eve");
    expect(invite.html).not.toContain("<script>alert");
  });
});
