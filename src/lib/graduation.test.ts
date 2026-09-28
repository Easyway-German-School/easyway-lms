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
});

describe("graduationVerdict", () => {
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
