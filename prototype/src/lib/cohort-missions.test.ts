import { describe, expect, it } from "vitest";

import { hasUnverifiedScheduleClaim } from "@/lib/cohort-missions";

describe("cohort mission schedule claims", () => {
  it("rejects a class slot and date that were not supplied to the cohort generator", () => {
    expect(hasUnverifiedScheduleClaim("Join the Morning A1 Class (15 Oct)", "Stay for at least 5 minutes.")).toBe(true);
  });

  it("rejects invented class weekdays and clock times", () => {
    expect(hasUnverifiedScheduleClaim("Join the A1 class on Tuesday", "It starts at 6:30 pm.")).toBe(true);
  });

  it("keeps schedule-neutral German practice missions", () => {
    expect(hasUnverifiedScheduleClaim("Write 5 simple sentences", "Use the present tense to describe your day.")).toBe(false);
  });
});
