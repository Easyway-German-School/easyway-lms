import { describe, expect, it } from "vitest";
import { dueStep, type ScheduleFacts } from "./journey-schedule";
import type { JourneyStep } from "./journey-emails";

const EXAM = new Date("2026-10-29T09:00:00+01:00");
const at = (iso: string) => new Date(iso);

const base: ScheduleFacts = {
  status: "booked",
  paymentStatus: "unpaid",
  createdAt: at("2026-09-25T09:00:00+01:00"),
  verifiedAt: null,
  infoConfirmedAt: null,
  admittedAt: null,
  examCompletedAt: null,
  resultReleasedAt: null,
  certificateReadyAt: null,
  prepInterestAt: null,
  missingFields: ["ID number"],
  examStart: EXAM,
};

const sent = (...s: JourneyStep[]) => new Set<JourneyStep>(s);
const due = (facts: Partial<ScheduleFacts>, s: JourneyStep[], now: string) =>
  dueStep({ ...base, ...facts }, sent(...s), at(now));

describe("before payment", () => {
  it("retries a booking confirmation that never went out", () => {
    expect(due({}, [], "2026-09-25T10:00:00+01:00")).toBe("booking_received");
  });

  it("sends one payment reminder the morning after — not the same day, not twice", () => {
    expect(due({}, ["booking_received"], "2026-09-25T18:00:00+01:00")).toBeNull();
    expect(due({}, ["booking_received"], "2026-09-26T09:00:00+01:00")).toBe("payment_reminder");
    expect(due({}, ["booking_received", "payment_reminder"], "2026-10-05T09:00:00+01:00")).toBeNull();
  });

  it("does not chase someone who has already submitted a slip, or is being refunded", () => {
    expect(due({ paymentStatus: "pending_verification" }, ["booking_received"], "2026-09-28T09:00:00+01:00")).toBeNull();
    expect(due({ paymentStatus: "refund_pending" }, [], "2026-09-28T09:00:00+01:00")).toBeNull();
    expect(due({ paymentStatus: "refund_failed" }, ["booking_received"], "2026-09-28T09:00:00+01:00")).toBeNull();
  });

  it("stops chasing once the exam date has passed", () => {
    expect(due({}, ["booking_received"], "2026-10-30T09:00:00+01:00")).toBeNull();
  });
});

describe("after payment", () => {
  const paid = { paymentStatus: "paid", verifiedAt: at("2026-09-27T10:00:00+01:00") };

  it("retries a payment confirmation that failed, but does not resurrect an old payment", () => {
    expect(due(paid, ["booking_received"], "2026-09-27T12:00:00+01:00")).toBe("payment_confirmed");
    expect(due({ ...paid, verifiedAt: at("2026-08-01T10:00:00+01:00") }, ["booking_received"], "2026-09-27T12:00:00+01:00")).toBeNull();
  });

  it("asks for details a day after payment, and only if they are still owed", () => {
    const s: JourneyStep[] = ["booking_received", "payment_confirmed"];
    expect(due(paid, s, "2026-09-27T18:00:00+01:00")).toBeNull();
    expect(due(paid, s, "2026-09-28T09:00:00+01:00")).toBe("info_check");
    // Details complete AND confirmed → nothing to chase.
    expect(due({ ...paid, missingFields: [], infoConfirmedAt: at("2026-09-27T20:00:00+01:00") }, s, "2026-09-28T09:00:00+01:00")).toBeNull();
  });

  it("holds the prep invitation until the admin chores are done and a few days have passed", () => {
    const early: JourneyStep[] = ["booking_received", "payment_confirmed"];
    // Day 3 but the info check hasn't gone yet and details are unconfirmed → info check first, not the pitch.
    expect(due(paid, early, "2026-09-30T09:00:00+01:00")).toBe("info_check");
    // Info check sent, day 3 → now the invitation.
    expect(due(paid, [...early, "info_check"], "2026-09-30T09:00:00+01:00")).toBe("prep_invite");
    // Same day but too soon.
    expect(due(paid, [...early, "info_check"], "2026-09-29T09:00:00+01:00")).toBeNull();
  });

  it("never pitches a class when the exam is too close for one to help, or to someone who already asked", () => {
    const s: JourneyStep[] = ["booking_received", "payment_confirmed", "info_check"];
    expect(due(paid, s, "2026-10-22T09:00:00+01:00")).toBeNull(); // 7 days out
    expect(due({ ...paid, prepInterestAt: at("2026-09-29T09:00:00+01:00") }, s, "2026-09-30T09:00:00+01:00")).toBeNull();
  });

  it("pitches nobody who has been cancelled or did not attend", () => {
    const s: JourneyStep[] = ["booking_received", "payment_confirmed", "info_check"];
    expect(due({ ...paid, status: "cancelled" }, s, "2026-09-30T09:00:00+01:00")).toBeNull();
    expect(due({ ...paid, status: "no_show" }, s, "2026-09-30T09:00:00+01:00")).toBeNull();
  });
});

describe("after admission", () => {
  const admitted = { paymentStatus: "paid", verifiedAt: at("2026-09-27T10:00:00+01:00"), admittedAt: at("2026-10-10T10:00:00+01:00"), infoConfirmedAt: at("2026-09-28T10:00:00+01:00"), missingFields: [] };
  const s: JourneyStep[] = ["booking_received", "payment_confirmed", "info_check", "prep_invite"];

  it("retries a missing admission letter first", () => {
    expect(due(admitted, s, "2026-10-10T12:00:00+01:00")).toBe("admission");
  });

  it("sends the guide a day after the letter", () => {
    expect(due(admitted, [...s, "admission"], "2026-10-10T18:00:00+01:00")).toBeNull();
    expect(due(admitted, [...s, "admission"], "2026-10-11T09:00:00+01:00")).toBe("exam_guide");
  });

  it("sends the one-week reminder inside a catch-up window, then the 24-hour one", () => {
    const done: JourneyStep[] = [...s, "admission", "exam_guide"];
    expect(due(admitted, done, "2026-10-21T09:00:00+01:00")).toBeNull(); // 8 days out
    expect(due(admitted, done, "2026-10-22T09:00:00+01:00")).toBe("reminder_7day");
    expect(due(admitted, done, "2026-10-25T09:00:00+01:00")).toBe("reminder_7day"); // cron missed a day or two
    expect(due(admitted, [...done, "reminder_7day"], "2026-10-27T09:00:00+01:00")).toBeNull();
    expect(due(admitted, [...done, "reminder_7day"], "2026-10-28T09:00:00+01:00")).toBe("reminder_24h");
  });

  it("does not remind on the exam day itself", () => {
    const done: JourneyStep[] = [...s, "admission", "exam_guide", "reminder_7day", "reminder_24h"];
    expect(due(admitted, done, "2026-10-29T08:00:00+01:00")).toBeNull();
  });

  it("gives a paid-but-not-admitted candidate no exam reminders at all", () => {
    const notAdmitted = { paymentStatus: "paid", verifiedAt: at("2026-09-27T10:00:00+01:00"), infoConfirmedAt: at("2026-09-28T10:00:00+01:00"), missingFields: [] };
    expect(due(notAdmitted, [...s], "2026-10-22T09:00:00+01:00")).toBeNull();
  });
});

describe("after the exam", () => {
  const done: JourneyStep[] = ["booking_received", "payment_confirmed", "info_check", "prep_invite", "admission", "exam_guide", "reminder_7day", "reminder_24h"];
  const facts = { paymentStatus: "paid", verifiedAt: at("2026-09-27T10:00:00+01:00"), admittedAt: at("2026-10-10T10:00:00+01:00"), infoConfirmedAt: at("2026-09-28T10:00:00+01:00"), missingFields: [], examCompletedAt: at("2026-10-29T15:00:00+01:00") };

  it("says the result is still pending only after ten quiet days", () => {
    expect(due(facts, done, "2026-11-05T09:00:00+01:00")).toBeNull();
    expect(due(facts, done, "2026-11-09T09:00:00+01:00")).toBe("result_pending");
  });

  it("never says 'pending' once a result exists", () => {
    expect(due({ ...facts, resultReleasedAt: at("2026-11-08T09:00:00+01:00") }, done, "2026-11-09T09:00:00+01:00")).toBe("result_released");
  });

  it("retries a certificate notice that failed", () => {
    expect(due({ ...facts, resultReleasedAt: at("2026-11-08T09:00:00+01:00"), certificateReadyAt: at("2026-11-20T09:00:00+01:00") }, [...done, "result_released"], "2026-11-21T09:00:00+01:00")).toBe("certificate_ready");
  });
});

describe("pacing", () => {
  it("returns at most one step, the earliest in journey order", () => {
    // Paid 4 days ago, never got a single email → confirmation first; the rest wait for later sweeps.
    const facts = { paymentStatus: "paid", verifiedAt: at("2026-09-27T10:00:00+01:00") };
    expect(due(facts, ["booking_received"], "2026-09-27T12:00:00+01:00")).toBe("payment_confirmed");
  });
});
