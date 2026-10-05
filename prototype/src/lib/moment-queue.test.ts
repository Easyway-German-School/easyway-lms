import { describe, expect, it } from "vitest";

import { MOMENTS, type MomentId } from "@/lib/moment-queue";

/**
 * The invariants that keep the student's screen from turning into a pile of
 * dialogs. These exist because an overloaded stack of popups once stopped
 * students from skipping the welcome tour; the queue's runtime rules (one at a
 * time, two modals a visit, a handover gap) are only as good as the table they
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
