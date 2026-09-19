import { describe, expect, it } from "vitest";
import {
  batchLockFloor,
  parseBatchLabel,
  resolveUpcomingBatch,
  seatStatusFor,
  withBatchFloor,
} from "./batch-reservation";

const NOW = new Date("2026-09-19T12:00:00Z");

describe("parseBatchLabel", () => {
  it("reads the shapes the office and the signup form actually produce", () => {
    expect(parseBatchLabel("October")).toEqual({ monthIndex: 9, year: null });
    expect(parseBatchLabel(" october ")).toEqual({ monthIndex: 9, year: null });
    expect(parseBatchLabel("October 2026")).toEqual({ monthIndex: 9, year: 2026 });
    expect(parseBatchLabel("Oct")).toEqual({ monthIndex: 9, year: null });
    expect(parseBatchLabel("Sept")).toEqual({ monthIndex: 8, year: null });
    expect(parseBatchLabel("Oct '26")).toEqual({ monthIndex: 9, year: 2026 });
  });

  it("refuses anything that is not a month, so it can never lock", () => {
    for (const bad of ["", "TBC", "Octoberfest", "next month", null, undefined, 42]) {
      expect(parseBatchLabel(bad)).toBeNull();
    }
  });
});

describe("resolveUpcomingBatch", () => {
  it("locks an October learner until 1 October, Lagos midnight", () => {
    const upcoming = resolveUpcomingBatch("October", { registeredAt: new Date("2026-08-04T10:00:00Z"), now: NOW });
    expect(upcoming?.monthLabel).toBe("October 2026");
    // 00:00 WAT on 1 Oct is 23:00 UTC on 30 Sept.
    expect(upcoming?.startsOn.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(upcoming?.daysUntilStart).toBe(12);
  });

  it("reads an explicit year as written", () => {
    const upcoming = resolveUpcomingBatch("October 2026", { registeredAt: new Date("2026-09-05T00:00:00Z"), now: NOW });
    expect(upcoming?.monthLabel).toBe("October 2026");
  });

  it("opens the portal once the first day has come", () => {
    const opened = new Date("2026-10-01T00:00:01+01:00");
    expect(resolveUpcomingBatch("October", { registeredAt: new Date("2026-09-05T00:00:00Z"), now: opened })).toBeNull();
    const eve = new Date("2026-09-30T23:59:00+01:00");
    expect(resolveUpcomingBatch("October", { registeredAt: new Date("2026-09-05T00:00:00Z"), now: eve })).not.toBeNull();
  });

  it("does not lock a batch that is already running", () => {
    // September intake, registered in August — began on 1 September.
    expect(resolveUpcomingBatch("September", { registeredAt: new Date("2026-08-19T00:00:00Z"), now: NOW })).toBeNull();
    expect(resolveUpcomingBatch("August 2026", { registeredAt: new Date("2026-08-19T00:00:00Z"), now: NOW })).toBeNull();
  });

  it("does not lock an ongoing learner carrying a stale bare month", () => {
    // Imported in August with batch "July" — forwards from registration that is
    // NEXT July, eleven months out. A label, not a reservation.
    expect(resolveUpcomingBatch("July", { registeredAt: new Date("2026-08-19T00:00:00Z"), now: NOW })).toBeNull();
    expect(resolveUpcomingBatch("April", { registeredAt: new Date("2026-08-09T00:00:00Z"), now: NOW })).toBeNull();
  });

  it("still locks an older learner the office deliberately moves to October", () => {
    // Registered in February; forwards from registration "October" is 1 Oct 2026.
    const upcoming = resolveUpcomingBatch("October", { registeredAt: new Date("2026-02-10T00:00:00Z"), now: NOW });
    expect(upcoming?.monthLabel).toBe("October 2026");
  });

  it("still locks a genuine early booking a few months out", () => {
    const upcoming = resolveUpcomingBatch("January", { registeredAt: new Date("2026-09-05T00:00:00Z"), now: NOW });
    expect(upcoming?.monthLabel).toBe("January 2027");
  });

  it("never locks a learner whose first day is confirmed and past", () => {
    expect(
      resolveUpcomingBatch("October", {
        registeredAt: new Date("2026-09-05T00:00:00Z"),
        classesStartedAt: new Date("2026-09-10T00:00:00Z"),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("returns null for no batch", () => {
    expect(resolveUpcomingBatch(null, { now: NOW })).toBeNull();
    expect(resolveUpcomingBatch("", { now: NOW })).toBeNull();
  });
});

describe("batchLockFloor / withBatchFloor", () => {
  it("floors the part-payment clock at the batch start, not the enrolment date", () => {
    const registeredAt = new Date("2026-09-05T00:00:00Z");
    const floor = batchLockFloor("October", { registeredAt, now: NOW });
    expect(floor?.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(withBatchFloor(registeredAt, floor)).toEqual(floor);
    // An anchor already after the floor is left alone.
    const later = new Date("2026-10-20T00:00:00Z");
    expect(withBatchFloor(later, floor)).toEqual(later);
  });

  it("stays out of the way when the office has confirmed a real first day", () => {
    expect(
      batchLockFloor("October", {
        registeredAt: new Date("2026-09-05T00:00:00Z"),
        classesStartedAt: new Date("2026-09-10T00:00:00Z"),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("seatStatusFor", () => {
  it("names the four places a learner can stand", () => {
    const none = { tuitionPaid: 0, registrationPaid: false, depositPaid: false, fullyPaid: false };
    expect(seatStatusFor(none)).toBe("unpaid");
    // The registration fee alone is not tuition — but it is not "nothing" either.
    expect(seatStatusFor({ ...none, registrationPaid: true })).toBe("registration_only");
    expect(seatStatusFor({ ...none, tuitionPaid: 15_000 })).toBe("registration_only");
    expect(seatStatusFor({ ...none, tuitionPaid: 90_000, registrationPaid: true, depositPaid: true })).toBe("deposit_paid");
    expect(seatStatusFor({ tuitionPaid: 150_000, registrationPaid: true, depositPaid: true, fullyPaid: true })).toBe("paid_in_full");
  });
});
