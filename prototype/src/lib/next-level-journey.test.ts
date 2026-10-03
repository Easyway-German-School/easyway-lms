import { describe, expect, it } from "vitest";
import {
  whyExcluded,
  buildRecap,
  cleanDetails,
  readIntent,
  resolveJourneyAudience,
  stageFor,
} from "./next-level-journey";

const now = new Date("2026-10-01T09:00:00Z");
const created = new Date("2026-07-20T10:00:00Z");

describe("resolveJourneyAudience", () => {
  it("opens the 'ended' route for an August batch the day after it ends", () => {
    const a = resolveJourneyAudience({
      level: "A1",
      admission: { batch: "August" },
      createdAt: created,
      classesStartedAt: new Date("2026-08-03T00:00:00Z"),
      now,
    });
    expect(a).toEqual({ state: "ended", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("judges a student with NO confirmed start date by their batch month, not drops them", () => {
    expect(
      resolveJourneyAudience({
        level: "A1",
        admission: { batch: "August" },
        createdAt: created,
        classesStartedAt: null,
        now,
      }),
    ).toEqual({ state: "ended", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("still respects a confirmed start date that is in the future", () => {
    expect(
      resolveJourneyAudience({
        level: "A1",
        admission: { batch: "August" },
        createdAt: created,
        classesStartedAt: new Date("2026-12-01T00:00:00Z"),
        now,
      }),
    ).toBeNull();
  });

  it("opens the halfway route a month into a level that is still running", () => {
    expect(
      resolveJourneyAudience({
        level: "A1",
        admission: { batch: "September" },
        createdAt: created,
        classesStartedAt: new Date("2026-09-01T00:00:00Z"),
        now,
      }),
    ).toEqual({ state: "midway", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("keeps a brand-new October intake out until it has had its first month", () => {
    const base = {
      level: "A1",
      admission: { batch: "October" },
      createdAt: created,
      classesStartedAt: new Date("2026-10-05T00:00:00Z"),
    };
    expect(resolveJourneyAudience({ ...base, now: new Date("2026-10-20T09:00:00Z") })).toBeNull();
    expect(resolveJourneyAudience({ ...base, now: new Date("2026-11-08T09:00:00Z") })?.state).toBe("midway");
  });

  it("stops welcoming people long after the batch ended", () => {
    expect(
      resolveJourneyAudience({
        level: "A1",
        admission: { batch: "August" },
        createdAt: created,
        classesStartedAt: new Date("2026-08-03T00:00:00Z"),
        now: new Date("2026-12-20T09:00:00Z"),
      }),
    ).toBeNull();
  });

  it("honours a human sign-off", () => {
    const a = resolveJourneyAudience({
      level: "A2",
      levelCompletedFor: "A2",
      levelCompletedAt: now,
      now,
    });
    expect(a).toEqual({ state: "signed_off", finishedLevel: "A2", targetLevel: "B1" });
  });

  it("recognises a graduate the desk already moved up and who is waiting", () => {
    const a = resolveJourneyAudience({
      level: "A2",
      admission: { batch: "October", classesStartedAtBeforePromotion: "2026-08-03T00:00:00.000Z" },
      createdAt: created,
      classesStartedAt: new Date("2026-10-12T00:00:00+01:00"),
      now,
    });
    expect(a).toEqual({ state: "promoted", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("is null at the top of the ladder", () => {
    expect(
      resolveJourneyAudience({ level: "C2", levelCompletedFor: "C2", levelCompletedAt: now, now }),
    ).toBeNull();
  });
});

describe("buildRecap", () => {
  const base = {
    firstName: "Ada",
    finishedLevel: "A1",
    targetLevel: "A2",
    classesAttended: 27,
    classesMarked: 30,
    lateCount: 2,
    gradeAverages: { speaking: 88, essay: 61, quiz: 74 },
    gradesCount: 6,
    videosCompleted: 12,
    assignmentsSubmitted: 5,
    gamesPlayed: 3,
    bestGameStreak: 5,
    archetype: "night_owl",
    peakHour: 21,
    peakWeekday: 2,
    longestStreak: 9,
    totalMinutes: 600,
    activeDays: 30,
    goalLabel: "Study at a German university",
    goalDestination: "your first lecture",
  };

  it("uses only real numbers and names the data behind each plan card", () => {
    const r = buildRecap(base);
    expect(r.stats.find((s) => s.key === "classes")).toMatchObject({ value: 27, suffix: "of 30" });
    expect(r.strength).toEqual({ skill: "speaking", score: 88 });
    expect(r.focus).toEqual({ skill: "writing", score: 61 });
    expect(r.rhythmLine).toBe("You do your best work around 9pm on Tuesdays.");
    expect(r.plan.every((p) => p.because.length > 0)).toBe(true);
    expect(r.plan.length).toBeLessThanOrEqual(4);
  });

  it("stays honest with almost no data", () => {
    const r = buildRecap({
      firstName: "Tunde",
      finishedLevel: "A1",
      targetLevel: "A2",
      classesAttended: 0,
      classesMarked: 0,
      lateCount: 0,
      gradeAverages: {},
      gradesCount: 0,
      videosCompleted: 0,
      assignmentsSubmitted: 0,
      gamesPlayed: 0,
      bestGameStreak: 0,
    });
    expect(r.thin).toBe(true);
    expect(r.stats).toHaveLength(0);
    expect(r.strength).toBeNull();
    expect(r.headline).not.toMatch(/look what you did/);
  });
});

describe("intent helpers", () => {
  it("stages follow the money first, then the intent", () => {
    expect(stageFor(null, "none")).toBe("not_opened");
    expect(stageFor({ targetLevel: "A2", seenAt: "x" }, "none")).toBe("opened");
    expect(stageFor({ targetLevel: "A2", seenAt: "x", heldAt: "y" }, "none")).toBe("held");
    expect(stageFor({ targetLevel: "A2", heldAt: "y" }, "deposit")).toBe("deposit_paid");
    expect(stageFor(null, "full")).toBe("paid_in_full");
  });

  it("does not carry an A2 intent over to B1", () => {
    expect(readIntent({ nextLevel: { targetLevel: "A2", seenAt: "x" } }, "B1")).toBeNull();
    expect(readIntent({ nextLevel: { targetLevel: "A2", seenAt: "x" } }, "a2")).not.toBeNull();
  });

  it("whitelists and bounds what the browser sends", () => {
    const d = cleanDetails({
      phone: "+234 801 234 5678",
      parentPhone: "<script>",
      sessionSlot: "EVENING",
      deliveryMode: "teleport",
      note: "x".repeat(900),
    });
    expect(d.phone).toBe("+234 801 234 5678");
    expect(d.parentPhone).toBeUndefined();
    expect(d.sessionSlot).toBe("evening");
    expect(d.deliveryMode).toBeUndefined();
    expect(d.note).toHaveLength(500);
  });
});

describe("whyExcluded", () => {
  const base = { level: "A1", createdAt: created, now };
  it("names the first rule that kept a student out", () => {
    expect(whyExcluded({ ...base, admission: {}, classesStartedAt: new Date("2026-08-03") })).toBe("no_batch");
    expect(whyExcluded({ ...base, admission: { batch: "August" }, classesStartedAt: new Date("2026-12-01") })).toBe("not_started");
    expect(whyExcluded({ ...base, admission: { batch: "October" }, classesStartedAt: new Date("2026-09-25") })).toBe("first_month");
    expect(
      whyExcluded({ ...base, admission: { batch: "May" }, classesStartedAt: new Date("2026-05-04"), createdAt: new Date("2026-04-20") }),
    ).toBe("long_finished");
    expect(whyExcluded({ ...base, level: "C2", admission: { batch: "August" } })).toBe("top_of_ladder");
  });
  it("is null for anyone who IS in the journey", () => {
    expect(whyExcluded({ ...base, admission: { batch: "August" }, classesStartedAt: new Date("2026-08-03") })).toBeNull();
  });
});

describe("manual offer (Students → Graduate)", () => {
  it("opens the journey for a student the automatic rules would skip", () => {
    const a = resolveJourneyAudience({
      level: "A1",
      admission: { batch: "October", nextLevel: { targetLevel: "A2", manualOffer: true } },
      createdAt: created,
      classesStartedAt: null,
      now,
    });
    expect(a).toEqual({ state: "invited", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("recognises a manually moved-up student even with no promotion marker", () => {
    const a = resolveJourneyAudience({
      level: "A2",
      admission: { batch: "October", nextLevel: { targetLevel: "A2", manualOffer: true } },
      createdAt: created,
      classesStartedAt: null,
      now,
    });
    expect(a).toEqual({ state: "promoted", finishedLevel: "A1", targetLevel: "A2" });
  });

  it("ignores an offer for the wrong level", () => {
    expect(
      resolveJourneyAudience({
        level: "A1",
        admission: { batch: "October", nextLevel: { targetLevel: "B2", manualOffer: true } },
        createdAt: created,
        classesStartedAt: null,
        now,
      }),
    ).toBeNull();
  });
});
