import { describe, expect, it } from "vitest";
import {
  buildRiskRadar,
  findRecoveryMatches,
  recoverySearchTerms,
  type RecoveryCandidate,
  type RiskObservation,
} from "./developer-recovery";

const candidates: RecoveryCandidate[] = [
  {
    id: "live-fix",
    source: "pull request",
    title: "Live classes no longer hang on Connecting you to your class",
    detail: "Retain the session through auth blips and let the student rejoin.",
    url: "https://github.com/Easyway-German-School/easyway-lms/pull/206",
    date: "2026-10-07",
    status: "merged",
  },
  {
    id: "auth-regression",
    source: "incident",
    title: "/api/auth: session cookie rejected",
    detail: "A transient server error was reported.",
    url: null,
    date: "2026-10-01",
    status: "resolved",
    resolutionNote: "Keep the existing session cookie on server faults.",
    reopenedCount: 2,
  },
  {
    id: "unrelated",
    source: "commit",
    title: "Add student avatar upload",
    detail: "Profile photos can now be updated.",
    url: "https://github.com/Easyway-German-School/easyway-lms/commit/abc",
    date: "2026-10-04",
  },
];

describe("recoverySearchTerms", () => {
  it("expands common words with related technical wording", () => {
    expect(recoverySearchTerms("video class keeps getting stuck")).toEqual(
      expect.arrayContaining(["live", "video", "classroom", "stuck", "connecting"]),
    );
  });
});

describe("findRecoveryMatches", () => {
  it("finds similar technical wording and ranks stable resolutions ahead of regressions", () => {
    const matches = findRecoveryMatches("student video class stuck connecting", candidates);
    expect(matches.map((match) => match.id)).toContain("live-fix");
    expect(matches.map((match) => match.id)).not.toContain("unrelated");
  });

  it("does not present a previously recurring resolution as the strongest fix", () => {
    const matches = findRecoveryMatches("auth session cookie problem", [
      ...candidates,
      {
        id: "auth-patch",
        source: "pull request",
        title: "Keep the session cookie on authentication server errors",
        detail: "Do not erase a valid session after a temporary server fault.",
        url: null,
        date: "2026-10-05",
        status: "merged",
      },
    ]);
    expect(matches[0]?.id).toBe("auth-patch");
  });

  it("returns no speculative match when the query has no overlap", () => {
    expect(findRecoveryMatches("unrelated glossary colors", candidates)).toEqual([]);
  });

  it("does not rank a single shared generic term for a longer query", () => {
    expect(findRecoveryMatches("class assignment message confusion", [
      {
        id: "class",
        source: "commit",
        title: "Improve class attendance page",
        detail: "A class list is displayed.",
        url: null,
        date: "2026-01-01",
      },
    ])).toEqual([]);
  });
});

describe("buildRiskRadar", () => {
  const liveSignals: RiskObservation[] = [
    {
      id: "live-1",
      source: "incident",
      title: "Live session connection keeps hanging",
      detail: "Student cannot connect to video room",
      route: "/api/live/session",
      date: "2026-10-08T09:00:00.000Z",
      status: "open",
      severity: "high",
      occurrences: 7,
      reopenedCount: 2,
    },
    {
      id: "live-2",
      source: "user report",
      title: "Bug report · /live",
      detail: "Video call connection stuck while joining live class",
      route: "/live",
      date: "2026-10-07T09:00:00.000Z",
      status: "reported",
      severity: "low",
      occurrences: 1,
      reopenedCount: 0,
    },
    {
      id: "live-3",
      source: "incident",
      title: "Connection hangs for live classroom",
      detail: "The video room stays stuck while connecting",
      route: "/api/live/session",
      date: "2026-10-06T09:00:00.000Z",
      status: "resolved",
      severity: "high",
      occurrences: 3,
      reopenedCount: 0,
    },
    {
      id: "old-payment",
      source: "incident",
      title: "Payment receipt is delayed",
      detail: "Paystack webhook receipt",
      route: "/api/payments/webhook",
      date: "2026-09-20T09:00:00.000Z",
      status: "resolved",
      severity: "critical",
      occurrences: 1,
      reopenedCount: 0,
    },
  ];

  it("surfaces an evidence-backed rising scenario without calling its score a probability", () => {
    const radar = buildRiskRadar(liveSignals, new Date("2026-10-08T12:00:00.000Z"));
    expect(radar.patternsExamined).toBeGreaterThan(1);
    expect(radar.predictions).toHaveLength(1);
    expect(radar.predictions[0]).toMatchObject({
      risk: "high",
      trend: "rising",
      confidence: "pattern evidence",
      counts: {
        records90d: 3,
        reports7d: 3,
        activeNow: 1,
        recurrences: 2,
      },
    });
    expect(radar.predictions[0].scenario).toContain("may");
    expect(radar.predictions[0].evidence.map((item) => item.id)).toContain("live-1");
  });

  it("does not turn a single old resolved event into a future-risk claim", () => {
    const radar = buildRiskRadar([liveSignals[3]], new Date("2026-10-08T12:00:00.000Z"));
    expect(radar.patternsExamined).toBe(1);
    expect(radar.predictions).toEqual([]);
  });

  it("raises an active high-severity incident to elevated risk even before it repeats", () => {
    const radar = buildRiskRadar([
      {
        ...liveSignals[0],
        status: "open",
        reopenedCount: 0,
      },
    ], new Date("2026-10-08T12:00:00.000Z"));
    expect(radar.predictions[0]).toMatchObject({
      risk: "elevated",
      counts: { activeNow: 1, reports7d: 1 },
    });
  });

  it("detects a recurrence even when there is no currently open incident", () => {
    const radar = buildRiskRadar([
      {
        ...liveSignals[0],
        status: "resolved",
        date: "2026-10-08T09:00:00.000Z",
      },
    ], new Date("2026-10-08T12:00:00.000Z"));
    expect(radar.predictions[0]).toMatchObject({
      risk: "elevated",
      trend: "steady",
      counts: { activeNow: 0, recurrences: 2 },
    });
  });
});
