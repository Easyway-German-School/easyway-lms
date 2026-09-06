import { describe, expect, it } from "vitest";

import { sessionsOverlap } from "./private-classes";

/**
 * The overlap check gates whether a private session can be booked at all, so
 * the two failure modes it exists to stop are pinned: flagging a legitimate
 * back-to-back session, and missing a real clash because it only looked at
 * start times.
 */
describe("sessionsOverlap", () => {
  const at = (iso: string) => new Date(iso);

  it("back-to-back sessions do not clash", () => {
    // 15:00–16:00 then 16:00–17:00
    expect(sessionsOverlap(at("2026-09-15T15:00:00Z"), 60, at("2026-09-15T16:00:00Z"), 60)).toBe(false);
  });

  it("a session starting inside another clashes", () => {
    // 15:00–16:00 vs 15:30–16:30
    expect(sessionsOverlap(at("2026-09-15T15:00:00Z"), 60, at("2026-09-15T15:30:00Z"), 60)).toBe(true);
  });

  it("a long session swallowing a short one clashes (start times far apart)", () => {
    // 15:00–18:00 vs 17:00–17:30 — the old start-time-only check would miss this
    expect(sessionsOverlap(at("2026-09-15T15:00:00Z"), 180, at("2026-09-15T17:00:00Z"), 30)).toBe(true);
  });

  it("sessions on different days do not clash", () => {
    expect(sessionsOverlap(at("2026-09-15T18:00:00Z"), 60, at("2026-09-16T18:00:00Z"), 60)).toBe(false);
  });

  it("is symmetric", () => {
    const a = at("2026-09-15T15:00:00Z");
    const b = at("2026-09-15T15:30:00Z");
    expect(sessionsOverlap(a, 60, b, 60)).toBe(sessionsOverlap(b, 60, a, 60));
  });
});
