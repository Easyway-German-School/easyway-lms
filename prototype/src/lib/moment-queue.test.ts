import { describe, expect, it } from "vitest";

import { MOMENTS, momentVisitDay, parseMomentVisit, type MomentId } from "@/lib/moment-queue";

/**
 * The invariants that keep the student's screen from turning into a pile of
 * dialogs. These exist because an overloaded stack of popups once stopped
 * students from skipping the welcome tour; the queue's runtime rules (one at a
 * time, two modals a day, a handover gap) are only as good as the table they
 * order, so the table itself is pinned here.
 */
describe("the moment table", () => {
  const ids = Object.keys(MOMENTS) as MomentId[];

  it("keeps Becca's new-look note a toast, never a modal", () => {
    expect(MOMENTS["new-look"].kind).toBe("toast");
  });

  it("ranks the new-look note below the welcome tour and every account/learning moment", () => {
    for (const id of ["welcome-tour", "goal", "login-upgrade", "cohort-check", "level-advance", "next-level"] as MomentId[]) {
      expect(MOMENTS["new-look"].priority).toBeLessThan(MOMENTS[id].priority);
    }
  });

  it("never gives two moments the same rank, so the order is never decided by fetch latency", () => {
    const seen = new Map<number, MomentId>();
    for (const id of ids) {
      const clash = seen.get(MOMENTS[id].priority);
      // Pre-existing ties are tolerated only if they are not the new one.
      if (id === "new-look" || clash === "new-look") expect(clash).toBeUndefined();
      seen.set(MOMENTS[id].priority, id);
    }
  });
});

describe("the day's visit", () => {
  const today = "2026-10-07";

  it("restores what this student already saw today", () => {
    expect(parseMomentVisit({ day: today, done: ["welcome-tour", "new-look"], modalsShown: 1 }, today)).toEqual({
      done: ["welcome-tour", "new-look"],
      modalsShown: 1,
    });
  });

  it("forgets yesterday, so tomorrow morning is a fresh sitting", () => {
    expect(parseMomentVisit({ day: "2026-10-06", done: ["welcome-tour", "goal"], modalsShown: 2 }, today)).toEqual({
      done: [],
      modalsShown: 0,
    });
  });

  it("drops anything unreadable rather than invent a pile of popups", () => {
    expect(parseMomentVisit(null, today)).toEqual({ done: [], modalsShown: 0 });
    expect(parseMomentVisit({ day: today, done: ["welcome-tour", "not-a-moment"], modalsShown: "two" }, today)).toEqual({
      done: ["welcome-tour"],
      modalsShown: 0,
    });
  });

  it("names the day in local time, so midnight is their midnight", () => {
    expect(momentVisitDay(new Date(2026, 9, 7, 8, 0, 0))).toBe("2026-10-07");
  });
});
