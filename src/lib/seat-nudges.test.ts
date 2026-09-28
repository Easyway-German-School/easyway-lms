import { describe, expect, it, vi } from "vitest";

// seat-nudges imports Prisma-backed modules at the top; the functions under
// test are pure, so stub the I/O edges rather than touching a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/notify", () => ({ KIND: { tuitionReminder: "tuition.reminder", announcement: "announcement" }, notify: vi.fn() }));
vi.mock("@/lib/batch-reservation-server", () => ({ loadUpcomingBatchRows: vi.fn() }));
vi.mock("@/lib/student-access", () => ({ getStudentAccess: vi.fn() }));

import {
  blastAudience,
  confirmedCount,
  confirmSeatMessage,
  countdownMessage,
  openingMessage,
  reserveMessage,
  tierFor,
  RESERVE_TIERS,
  COUNTDOWN_TIERS,
} from "./seat-nudges";
import type { SeatRow } from "./batch-reservation-server";

const row = (over: Partial<SeatRow> = {}): SeatRow => ({
  studentId: "s1",
  userId: "u1",
  name: "Adaeze Okafor",
  email: "a@example.com",
  phone: "",
  branchId: null,
  branch: "Lagos",
  level: "A1",
  sessionSlot: "morning",
  classType: "group",
  createdAt: "2026-09-05T00:00:00.000Z",
  batch: "October",
  batchLabel: "October 2026",
  monthKey: "2026-10",
  startsOn: "2026-09-30T23:00:00.000Z",
  daysUntilStart: 12,
  seat: "unpaid",
  tuitionPaid: 0,
  registrationPaid: false,
  tuitionFee: 150_000,
  requiredDeposit: 90_000,
  depositOutstanding: 90_000,
  balanceOutstanding: 150_000,
  firstPaidAt: null,
  seatNumber: null,
  ...over,
});

describe("tierFor", () => {
  it("sends the smallest milestone already reached, never a burst", () => {
    expect(tierFor(30, RESERVE_TIERS)).toBeNull();
    expect(tierFor(21, RESERVE_TIERS)).toBe(21);
    // A learner first seen at 12 days gets the 14-day message, not all of 21/14.
    expect(tierFor(12, RESERVE_TIERS)).toBe(14);
    expect(tierFor(7, RESERVE_TIERS)).toBe(7);
    expect(tierFor(2, RESERVE_TIERS)).toBe(3);
    expect(tierFor(0, RESERVE_TIERS)).toBe(1);
  });

  it("gives paid learners only two touches", () => {
    expect(tierFor(30, COUNTDOWN_TIERS)).toBeNull();
    expect(tierFor(8, COUNTDOWN_TIERS)).toBeNull();
    expect(tierFor(7, COUNTDOWN_TIERS)).toBe(7);
    expect(tierFor(4, COUNTDOWN_TIERS)).toBe(7);
    expect(tierFor(1, COUNTDOWN_TIERS)).toBe(1);
  });
});

describe("reserveMessage", () => {
  it("names the deposit and the real number of secured seats", () => {
    const draft = reserveMessage(row(), 12, 5);
    expect(draft.message).toContain("Adaeze");
    expect(draft.message).toContain("₦90,000");
    expect(draft.message).toContain("5 learners have already secured theirs");
    expect(draft.title).toBe("Your October seat is waiting");
  });

  it("does not invent social proof when nobody has paid", () => {
    expect(reserveMessage(row(), 12, 0).message).not.toContain("already secured");
  });

  it("speaks to a registration-only learner about the deposit still to go", () => {
    const draft = reserveMessage(row({ seat: "registration_only", registrationPaid: true, depositOutstanding: 60_000 }), 5, 0);
    expect(draft.message).toContain("Your registration is in");
    expect(draft.message).toContain("₦60,000 to go");
  });

  it("gets more urgent as the day nears", () => {
    expect(reserveMessage(row(), 3, 0).title).toBe("3 days left to reserve your October seat");
    expect(reserveMessage(row(), 1, 0).title).toBe("Tomorrow: October classes begin");
  });
});

describe("countdownMessage / openingMessage", () => {
  it("celebrates a held seat and mentions the balance only when one is owed", () => {
    const held = countdownMessage(row({ seat: "deposit_paid", seatNumber: 4, balanceOutstanding: 60_000 }), 7);
    expect(held.message).toContain("seat #4");
    expect(held.message).toContain("₦60,000");
    const full = countdownMessage(row({ seat: "paid_in_full", seatNumber: 2, balanceOutstanding: 0 }), 7);
    expect(full.message).not.toContain("remaining");
  });

  it("tells an unpaid learner the deposit opens their classroom on opening day", () => {
    expect(openingMessage("Adaeze Okafor", "October", false).message).toContain("Pay your deposit");
    expect(openingMessage("Adaeze Okafor", "October", true).title).toContain("doors are open");
  });
});

describe("one-press confirm-your-seat message", () => {
  const unpaid = row();
  const regOnly = row({ studentId: "s2", seat: "registration_only", registrationPaid: true, depositOutstanding: 60_000 });
  const deposit = row({ studentId: "s3", seat: "deposit_paid", tuitionPaid: 90_000, depositOutstanding: 0, balanceOutstanding: 60_000 });
  const full = row({ studentId: "s4", seat: "paid_in_full", tuitionPaid: 150_000, depositOutstanding: 0, balanceOutstanding: 0 });
  const all = [unpaid, regOnly, deposit, full];

  it("reaches everyone who has not finished paying, never the paid-in-full", () => {
    expect(blastAudience(all).map((r) => r.studentId)).toEqual(["s1", "s2", "s3"]);
    expect(blastAudience(all, { includeDeposit: false }).map((r) => r.studentId)).toEqual(["s1", "s2"]);
  });

  it("counts only genuinely confirmed seats as 'confirmed'", () => {
    expect(confirmedCount(all)).toBe(2);
  });

  it("frames an unpaid learner's seat as reserved and asks them to confirm it", () => {
    const draft = confirmSeatMessage(unpaid, 0);
    expect(draft.title).toBe("Your October seat is reserved — confirm it");
    expect(draft.message).toContain("A seat has been reserved for you in the October intake");
    expect(draft.message).toContain("₦90,000 deposit");
    // Zero confirmed learners: the sentence is simply not said.
    expect(draft.message).not.toMatch(/already confirmed/);
  });

  it("states only the real number of confirmed learners", () => {
    expect(confirmSeatMessage(unpaid, 1).message).toContain("1 learner has already confirmed theirs.");
    expect(confirmSeatMessage(unpaid, 7).message).toContain("7 learners have already confirmed theirs.");
  });

  it("asks a registration-only learner for what is left of the deposit", () => {
    const draft = confirmSeatMessage(regOnly, 0);
    expect(draft.message).toContain("your registration is in");
    expect(draft.message).toContain("₦60,000");
  });

  it("tells a deposit-paid learner their seat is confirmed and shows the balance", () => {
    const draft = confirmSeatMessage(deposit, 5);
    expect(draft.title).toBe("Your October seat is confirmed — finish your payment");
    expect(draft.message).toContain("₦60,000");
    expect(draft.message).not.toMatch(/reserved for you/);
  });

  it("gives every learner in the same position identical wording so they send as one group", () => {
    const twin = row({ studentId: "s9", name: "Someone Else" });
    expect(confirmSeatMessage(twin, 3)).toEqual(confirmSeatMessage(unpaid, 3));
  });
});
