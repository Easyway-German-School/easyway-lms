import { describe, expect, it } from "vitest";
import { findRecoveryMatches, recoverySearchTerms, type RecoveryCandidate } from "./developer-recovery";

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
