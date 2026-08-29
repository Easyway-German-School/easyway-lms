import { describe as suite, expect, it } from "vitest";

import {
  buildProfile,
  buildSittings,
  classify,
  describe as narrate,
  featureLift,
  normalisedEntropy,
  readCohort,
  bestHours,
  type CohortMember,
  type RawEvent,
} from "./learner-signals";

/**
 * These tests exist because somebody will ring a real student on the strength
 * of a number produced by this file. The scores are opinions expressed as
 * arithmetic, and an opinion that changes silently when a helper is refactored
 * is exactly the failure worth spending a test suite on.
 */

const NOW = new Date("2026-08-22T12:00:00.000Z");

function event(partial: Partial<RawEvent> & { occurredAt: string }): RawEvent {
  return {
    area: "lessons",
    action: "view",
    durationSeconds: 120,
    ...partial,
  };
}

/** A learner who is on at the same hour on the same days, for weeks. */
function clockworkEvents(): RawEvent[] {
  const events: RawEvent[] = [];
  for (let week = 0; week < 6; week += 1) {
    for (const offset of [0, 2, 4]) {
      const day = new Date(NOW.getTime() - (week * 7 + offset) * 86400000);
      events.push(
        event({
          occurredAt: day.toISOString(),
          hourLocal: 20,
          weekday: day.getUTCDay(),
          sessionKey: `s-${week}-${offset}`,
          durationSeconds: 900,
        }),
      );
    }
  }
  return events;
}

suite("normalisedEntropy", () => {
  it("is 0 when everything sits in one bucket and 1 when it is flat", () => {
    expect(normalisedEntropy([10, 0, 0, 0])).toBe(0);
    expect(normalisedEntropy([5, 5, 5, 5])).toBeCloseTo(1, 6);
  });

  it("refuses to divide by zero on an empty or single-bucket distribution", () => {
    expect(normalisedEntropy([])).toBe(0);
    expect(normalisedEntropy([0, 0, 0])).toBe(0);
    expect(normalisedEntropy([7])).toBe(0);
  });
});

suite("buildSittings", () => {
  it("groups by the browser's session key, not by wall clock", () => {
    const sittings = buildSittings([
      event({ occurredAt: "2026-08-20T09:00:00Z", sessionKey: "a", durationSeconds: 60 }),
      event({ occurredAt: "2026-08-20T09:05:00Z", sessionKey: "a", durationSeconds: 60 }),
      event({ occurredAt: "2026-08-20T09:06:00Z", sessionKey: "b", durationSeconds: 60 }),
    ]);
    expect(sittings).toHaveLength(2);
    expect(sittings[0].events).toBe(2);
  });

  it("falls back to a 30-minute gap for rows written before sessionKey existed", () => {
    const sittings = buildSittings([
      event({ occurredAt: "2026-08-20T09:00:00Z", sessionKey: null }),
      event({ occurredAt: "2026-08-20T09:10:00Z", sessionKey: null }),
      event({ occurredAt: "2026-08-20T14:00:00Z", sessionKey: null }),
    ]);
    expect(sittings).toHaveLength(2);
  });

  it("bills the wall-clock span when dwell under-counts it", () => {
    // Two events ten minutes apart, each claiming one minute of dwell. The
    // last page of a visit is never billed, so the span is the truer figure.
    const [sitting] = buildSittings([
      event({ occurredAt: "2026-08-20T09:00:00Z", sessionKey: "a", durationSeconds: 60 }),
      event({ occurredAt: "2026-08-20T09:10:00Z", sessionKey: "a", durationSeconds: 60 }),
    ]);
    expect(sitting.minutes).toBe(10);
  });
});

suite("buildProfile", () => {
  it("reports no-evidence rather than a confident zero for a brand new learner", () => {
    const profile = buildProfile([event({ occurredAt: NOW.toISOString(), hourLocal: 9 })], NOW);
    expect(profile.archetype).toBe("newcomer");
    expect(profile.peakHour).toBe(9);
  });

  it("gives a never-seen learner maximum risk and no peak hour", () => {
    const profile = buildProfile([], NOW);
    expect(profile.riskScore).toBe(100);
    expect(profile.engagementScore).toBe(0);
    expect(profile.peakHour).toBeNull();
    expect(profile.daysSinceSeen).toBeNull();
  });

  it("uses the LEARNER'S clock, not the server's", () => {
    // Written at 12:00 UTC but stamped 23:00 by the browser: the profile must
    // follow the browser or every student in Lagos looks like an early bird.
    const profile = buildProfile(
      Array.from({ length: 12 }, (_, index) =>
        event({
          occurredAt: new Date(NOW.getTime() - index * 86400000).toISOString(),
          hourLocal: 23,
          weekday: 3,
          durationSeconds: 600,
        }),
      ),
      NOW,
    );
    expect(profile.peakHour).toBe(23);
  });

  it("scores a regular evening learner as clockwork and highly predictable", () => {
    const profile = buildProfile(clockworkEvents(), NOW);
    expect(profile.predictability).toBeGreaterThan(0.55);
    expect(profile.peakHour).toBe(20);
    expect(["clockwork", "night_owl"]).toContain(profile.archetype);
  });

  it("ignores events outside the window", () => {
    const profile = buildProfile(
      [event({ occurredAt: "2025-01-01T09:00:00Z" }), event({ occurredAt: NOW.toISOString() })],
      NOW,
    );
    expect(profile.totalEvents).toBe(1);
  });

  it("does not count a run that ended weeks ago as a live streak", () => {
    const profile = buildProfile(
      [0, 1, 2, 3].map((offset) =>
        event({ occurredAt: new Date(NOW.getTime() - (20 + offset) * 86400000).toISOString() }),
      ),
      NOW,
    );
    expect(profile.signals.longestStreak).toBe(4);
    expect(profile.signals.currentStreak).toBe(0);
  });

  it("counts a run that reaches today as live", () => {
    const profile = buildProfile(
      [0, 1, 2].map((offset) => event({ occurredAt: new Date(NOW.getTime() - offset * 86400000).toISOString() })),
      NOW,
    );
    expect(profile.signals.currentStreak).toBe(3);
  });

  it("reads a collapse in attention as a negative trend", () => {
    const busyEarly = Array.from({ length: 20 }, (_, index) =>
      event({ occurredAt: new Date(NOW.getTime() - (40 + index) * 86400000).toISOString(), durationSeconds: 900 }),
    );
    const quietLately = [event({ occurredAt: new Date(NOW.getTime() - 5 * 86400000).toISOString(), durationSeconds: 60 })];
    const profile = buildProfile([...busyEarly, ...quietLately], NOW);
    expect(profile.signals.trend).toBeLessThan(-0.4);
  });

  it("keeps risk and engagement independent — a climbing learner is not high risk", () => {
    const climbing = Array.from({ length: 14 }, (_, index) =>
      event({ occurredAt: new Date(NOW.getTime() - index * 86400000).toISOString(), durationSeconds: 900, hourLocal: 19 }),
    );
    const profile = buildProfile(climbing, NOW);
    expect(profile.riskScore).toBeLessThan(40);
    expect(profile.engagementScore).toBeGreaterThan(50);
  });
});

suite("classify", () => {
  const base = buildProfile(clockworkEvents(), NOW);

  it("calls silence a ghost before it calls anything else anything", () => {
    const stale = buildProfile(
      Array.from({ length: 30 }, (_, index) =>
        event({ occurredAt: new Date(NOW.getTime() - (20 + index) * 86400000).toISOString(), hourLocal: 23 }),
      ),
      NOW,
    );
    // Peak hour 23 would say "night owl"; not having shown up in three weeks
    // outranks it.
    expect(stale.peakHour).toBe(23);
    expect(stale.archetype).toBe("ghost");
  });

  it("spots a weekend crammer", () => {
    const weekend = { ...base.signals, weekdayHistogram: [500, 10, 10, 10, 10, 10, 500] };
    expect(classify({ ...base, signals: weekend, daysSinceSeen: 0 })).toBe("weekend_crammer");
  });

  it("spots a community-first learner", () => {
    const social = {
      ...base.signals,
      weekdayHistogram: [10, 100, 100, 100, 100, 100, 10],
      areaMix: [
        { area: "community", seconds: 900, events: 40, share: 0.7 },
        { area: "lessons", seconds: 300, events: 5, share: 0.3 },
      ],
    };
    expect(classify({ ...base, signals: social, daysSinceSeen: 1 })).toBe("social");
  });

  it("spots a skimmer: often present, never staying", () => {
    expect(
      classify({
        ...base,
        signals: { ...base.signals, weekdayHistogram: [10, 100, 100, 100, 100, 100, 10], areaMix: [] },
        daysSinceSeen: 0,
        avgSessionMinutes: 1.2,
        sessionsPerWeek: 9,
      }),
    ).toBe("skimmer");
  });
});

suite("featureLift", () => {
  function member(userId: string, group: string, mix: Array<[string, number]>): CohortMember {
    return {
      userId,
      name: userId,
      group,
      profile: {
        archetype: "steady",
        engagementScore: 50,
        riskScore: 20,
        predictability: 0.4,
        peakHour: 19,
        avgSessionMinutes: 10,
        sessionsPerWeek: 3,
        signals: {
          areaMix: mix.map(([area, seconds]) => ({ area, seconds, events: 1, share: 0 })),
          hourHistogram: new Array(24).fill(0).map((_, hour) => (hour === 19 ? 100 : 0)),
          weekdayHistogram: new Array(7).fill(10),
        },
      },
    };
  }

  const b1 = [
    member("a", "B1", [["community", 800], ["lessons", 200]]),
    member("b", "B1", [["community", 700], ["lessons", 300]]),
    member("c", "B1", [["community", 900], ["lessons", 100]]),
  ];
  const a1 = [
    member("d", "A1", [["community", 100], ["lessons", 900]]),
    member("e", "A1", [["community", 200], ["lessons", 800]]),
    member("f", "A1", [["community", 100], ["lessons", 900]]),
  ];
  const school = [...b1, ...a1];

  it("finds the surface a group over-indexes on rather than the one it uses most", () => {
    const rows = featureLift(b1, school);
    const community = rows.find((row) => row.area === "community")!;
    expect(community.lift).toBeGreaterThan(1.5);
    const lessons = rows.find((row) => row.area === "lessons")!;
    expect(lessons.lift).toBeLessThan(1);
  });

  it("carries the learner count so a one-person spike can be shown as noise", () => {
    const rows = featureLift(b1, school);
    expect(rows.every((row) => row.learners === 3)).toBe(true);
  });

  it("skips a surface the school has no time on at all rather than dividing by zero", () => {
    const withGhostArea = [...b1, member("g", "B1", [["brand-new-page", 500]])];
    const rows = featureLift(withGhostArea, b1);
    expect(rows.some((row) => row.area === "brand-new-page")).toBe(false);
    expect(rows.every((row) => Number.isFinite(row.lift))).toBe(true);
  });

  it("reads a group of identical learners as highly cohesive", () => {
    const bigB1 = [...b1, member("x", "B1", [["community", 800], ["lessons", 200]]), member("y", "B1", [["community", 850], ["lessons", 150]])];
    const reading = readCohort(bigB1, school, "B1");
    expect(reading.learners).toBe(5);
    expect(reading.measured).toBe(5);
    expect(reading.cohesion).toBe(1);
    expect(reading.peakHour).toBe(19);
  });

  it("refuses to call an unobserved level cohesive", () => {
    // Three people is not a group pattern, however alike they look.
    const reading = readCohort(b1, school, "B1");
    expect(reading.measured).toBe(3);
    expect(reading.cohesion).toBe(0);
  });

  it("does not count people we have never seen as at risk", () => {
    // Silence scores 100 for risk, which is right as arithmetic and wrong as a
    // claim about a person who only enrolled last week.
    const newcomers = Array.from({ length: 6 }, (_, index) => {
      const row = member(`n${index}`, "A1", [["dashboard", 10]]);
      row.profile.archetype = "newcomer";
      row.profile.riskScore = 100;
      return row;
    });
    const reading = readCohort(newcomers, school, "A1");
    expect(reading.learners).toBe(6);
    expect(reading.measured).toBe(0);
    expect(reading.atRisk).toBe(0);
    expect(reading.cohesion).toBe(0);
  });
});

suite("bestHours and describe", () => {
  it("returns the hours actually worth scheduling and drops the stray 3am visit", () => {
    const profile = buildProfile(
      [
        ...Array.from({ length: 20 }, (_, index) =>
          event({ occurredAt: new Date(NOW.getTime() - index * 86400000).toISOString(), hourLocal: 20, durationSeconds: 900 }),
        ),
        event({ occurredAt: new Date(NOW.getTime() - 3 * 86400000).toISOString(), hourLocal: 3, durationSeconds: 30 }),
      ],
      NOW,
    );
    expect(bestHours(profile)).toContain(20);
    expect(bestHours(profile)).not.toContain(3);
  });

  it("says plainly when there is nothing to report", () => {
    expect(narrate(buildProfile([], NOW), "Ada")).toContain("has not opened the portal");
  });

  it("names the person and the rhythm in one sentence", () => {
    const line = narrate(buildProfile(clockworkEvents(), NOW), "Ada");
    expect(line.startsWith("Ada is")).toBe(true);
    expect(line).toContain("8pm");
  });
});
