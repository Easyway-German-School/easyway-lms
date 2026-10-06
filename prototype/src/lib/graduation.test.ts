import { describe, expect, it } from "vitest";
import { cohortTiming, graduationVerdict, nextPlacement, GRADUATE_LEAD_DAYS } from "./graduation";

const at = (iso: string) => new Date(iso);
const registered = at("2026-08-03T10:00:00.000Z");

describe("cohortTiming", () => {
  it("treats an August batch as running until 30 September", () => {
    const timing = cohortTiming({ batch: "August", registeredAt: registered, now: at("2026-09-10T10:00:00.000Z") });
    expect(timing?.ended).toBe(false);
    expect(timing?.endsOn.getMonth()).toBe(8); // September
    expect(timing?.endsOn.getDate()).toBe(30);
    // 20 days out: beyond the lead window, so not yet graduatable.
    expect(timing?.graduatable).toBe(false);
  });

  it("opens the window in the last two weeks", () => {
    const timing = cohortTiming({ batch: "August", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") });
    expect(timing?.ended).toBe(false);
    expect(timing?.daysToEnd).toBeLessThanOrEqual(GRADUATE_LEAD_DAYS);
    expect(timing?.graduatable).toBe(true);
  });

  it("is ended once the last day has passed", () => {
    const timing = cohortTiming({ batch: "August", registeredAt: registered, now: at("2026-10-02T10:00:00.000Z") });
    expect(timing?.ended).toBe(true);
    expect(timing?.graduatable).toBe(true);
  });

  it("gives the weekend sitting three months", () => {
    const timing = cohortTiming({ batch: "August", sessionSlot: "weekend", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") });
    expect(timing?.endsOn.getMonth()).toBe(9); // October
    expect(timing?.graduatable).toBe(false);
  });

  it("never offers a batch that has not begun", () => {
    const timing = cohortTiming({ batch: "October", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") });
    expect(timing?.graduatable).toBe(false);
  });

  it("returns null for an unreadable batch", () => {
    expect(cohortTiming({ batch: "TBC", now: at("2026-09-28T10:00:00.000Z") })).toBeNull();
    expect(cohortTiming({ batch: null, now: at("2026-09-28T10:00:00.000Z") })).toBeNull();
  });
});

describe("nextPlacement", () => {
  it("lands an August batch in October, opening on the 1st", () => {
    const place = nextPlacement({ batch: "August", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") });
    expect(place?.month).toBe("October");
    expect(place?.year).toBe(2026);
    expect(place?.label).toBe("October 2026");
    expect(place?.hasStarted).toBe(false);
  });

  it("honours a moved opening day", () => {
    const place = nextPlacement({
      batch: "August",
      registeredAt: registered,
      now: at("2026-09-28T10:00:00.000Z"),
      startDayOverrides: { "2026-10": 5 },
    });
    expect(place?.startsOn.toISOString()).toBe("2026-10-04T23:00:00.000Z"); // 5 Oct 00:00 Lagos
  });

  it("wraps the year end", () => {
    const place = nextPlacement({
      batch: "November",
      registeredAt: at("2026-11-02T10:00:00.000Z"),
      now: at("2026-12-29T10:00:00.000Z"),
    });
    expect(place?.month).toBe("January");
    expect(place?.year).toBe(2027);
  });

  it("never places a late graduation in the past", () => {
    const place = nextPlacement({ batch: "August", registeredAt: registered, now: at("2026-11-15T10:00:00.000Z") });
    expect(place?.month).toBe("November");
    expect(place?.hasStarted).toBe(true);
  });

  it("puts a weekend batch three months on", () => {
    const place = nextPlacement({ batch: "August", sessionSlot: "weekend", registeredAt: registered, now: at("2026-10-28T10:00:00.000Z") });
    expect(place?.month).toBe("November");
  });

  it("lands the learner in the intake they chose, when it is the default month or later", () => {
    const base = { batch: "August", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") };
    expect(nextPlacement({ ...base, preferredMonth: "October" })?.month).toBe("October");
    expect(nextPlacement({ ...base, preferredMonth: "November" })?.label).toBe("November 2026");
  });

  it("wraps a chosen month across the year end", () => {
    const place = nextPlacement({
      batch: "October",
      registeredAt: at("2026-10-02T10:00:00.000Z"),
      now: at("2026-12-28T10:00:00.000Z"),
      preferredMonth: "February",
    });
    expect(place?.label).toBe("February 2027");
  });

  it("falls back to the default when the choice is stale or closed", () => {
    const base = { batch: "August", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z") };
    // September is already closed; January is further out than the three intakes on offer.
    expect(nextPlacement({ ...base, preferredMonth: "September" })?.label).toBe("October 2026");
    expect(nextPlacement({ ...base, preferredMonth: "January" })?.label).toBe("October 2026");
    // Chose October, but the move only happened in November: November, never October 2027.
    expect(
      nextPlacement({ ...base, now: at("2026-11-10T10:00:00.000Z"), preferredMonth: "October" })?.label,
    ).toBe("November 2026");
  });

  it("ignores a month name it does not know", () => {
    const place = nextPlacement({
      batch: "August",
      registeredAt: registered,
      now: at("2026-09-28T10:00:00.000Z"),
      preferredMonth: "Smarch",
    });
    expect(place?.label).toBe("October 2026");
  });
});

describe("graduationVerdict", () => {
  it("blocks a learner who has not paid the deposit, even with no money owed on record", () => {
    // No charge row means priorLevelOwed is 0; only the deposit check can catch this learner.
    const verdict = graduationVerdict({ level: "A1", heldBackAt: null, hasStarted: true, paidDeposit: false, priorLevelOwed: 0 });
    expect(verdict.state).toBe("blocked");
    expect(verdict.state === "blocked" && verdict.reason).toBe("unpaid");
  });

  it("lets a learner who has paid the deposit through, and treats an omitted flag as paid", () => {
    expect(graduationVerdict({ level: "A1", heldBackAt: null, hasStarted: true, paidDeposit: true, priorLevelOwed: 0 }).state).toBe("ready");
    expect(graduationVerdict({ level: "A1", heldBackAt: null, hasStarted: true, priorLevelOwed: 0 }).state).toBe("ready");
  });

  it("still lets the office hold someone back before anything else", () => {
    const verdict = graduationVerdict({ level: "A1", heldBackAt: new Date(), hasStarted: true, paidDeposit: false, priorLevelOwed: 0 });
    expect(verdict.state === "blocked" && verdict.reason).toBe("held_back");
  });

  const base = { level: "A1", heldBackAt: null, hasStarted: true, priorLevelOwed: 0 };

  it("is ready when started, not held and owing nothing", () => {
    expect(graduationVerdict(base)).toEqual({ state: "ready" });
  });

  it("blocks a learner the office held back, whatever else is true", () => {
    const verdict = graduationVerdict({ ...base, heldBackAt: new Date(), heldBackReason: "Failed assessment" });
    expect(verdict).toMatchObject({ state: "blocked", reason: "held_back" });
    expect((verdict as { detail: string }).detail).toContain("Failed assessment");
  });

  it("blocks a learner who never started — the calendar alone is not proof of attendance", () => {
    expect(graduationVerdict({ ...base, hasStarted: false })).toMatchObject({ state: "blocked", reason: "never_started" });
  });

  it("blocks on money owed for a past level and says how much", () => {
    const verdict = graduationVerdict({ ...base, priorLevelOwed: 60_000, formatMoney: (v) => `₦${v}` });
    expect(verdict).toMatchObject({ state: "blocked", reason: "fees" });
    expect((verdict as { detail: string }).detail).toBe("Owes ₦60000 on A1");
  });

  it("has nowhere to send a C2 learner", () => {
    expect(graduationVerdict({ ...base, level: "C2" })).toMatchObject({ state: "blocked", reason: "top_of_ladder" });
  });
});

describe("nextPlacement — per-level opening day", () => {
  const overrides = { "2026-10:A1": 5, "2026-10:A2": 12 };
  const base = { batch: "August", registeredAt: registered, now: at("2026-09-28T10:00:00.000Z"), startDayOverrides: overrides };

  it("opens A2 on the 12th when the office set A2 to open then", () => {
    const place = nextPlacement({ ...base, level: "A2" });
    expect(place?.label).toBe("October 2026");
    // Lagos midnight on the 12th is 23:00 UTC on the 11th.
    expect(place?.startsOn.toISOString()).toBe("2026-10-11T23:00:00.000Z");
  });

  it("opens A1 on the 5th", () => {
    expect(nextPlacement({ ...base, level: "A1" })?.startsOn.toISOString()).toBe("2026-10-04T23:00:00.000Z");
  });

  it("falls back to the month's day when the level has no override", () => {
    expect(nextPlacement({ ...base, level: "B1" })?.startsOn.toISOString()).toBe("2026-09-30T23:00:00.000Z");
  });
});
