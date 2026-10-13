import { describe, expect, it } from "vitest";
import { deriveStudentAccess } from "./access";

/**
 * These tests exist because the fields tested here were the exact ones two
 * routes dropped when they called `deriveStudentAccess` directly instead of
 * going through `getStudentAccess`/`accessFromStudent` (lib/student-access.ts):
 *   - the admin dossier, 2026-09-14 (missing `charges`, `flatDeposit`)
 *   - `/api/live/session` + 2 more routes, 2026-09-15 (missing `charges`,
 *     `flatDeposit`, `paymentPlanOnTrack`)
 * Both times a student the ledger correctly considered paid up got a wrong
 * answer from whichever route had dropped the field. Each test below pins one
 * of those fields: it asserts what happens WITH it (the correct answer) and
 * WITHOUT it (the wrong answer a hand-rolled caller would get instead), so a
 * future regression — someone reimplementing this call — shows up here before
 * it reaches a student. See also scripts/check-payment-gate-drift.mjs, which
 * catches the reimplementation itself rather than its symptom.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("deriveStudentAccess — omitting paymentPlanOnTrack", () => {
  // A part-payer, 40 days into classes (past the 30-day grace window), who has
  // an active tuition payment plan they are keeping to.
  const base = {
    totalPaid: 90_000,
    tuitionFee: 150_000,
    requiredDeposit: 90_000,
    classesStartedAt: daysAgo(40),
    paymentGraceUntil: null,
    now: NOW,
  };

  it("wrongly locks a student on an on-track payment plan when the flag is dropped", () => {
    const access = deriveStudentAccess(base); // paymentPlanOnTrack omitted
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unsettled_balance");
  });

  it("correctly leaves them open when paymentPlanOnTrack is passed", () => {
    const access = deriveStudentAccess({ ...base, paymentPlanOnTrack: true });
    expect(access.hasAccess).toBe(true);
    expect(access.lockReason).toBeNull();
  });
});

describe("deriveStudentAccess — omitting the tuition ledger (charges)", () => {
  // A student promoted from A1 to A2. A1 (₦150,000) was paid in full at
  // signup; nothing has been paid toward A2 yet. Lifetime totalPaid (₦150,000)
  // happens to equal the flat per-level fee, which is exactly the trap: a
  // raw sum-vs-flat-fee comparison reads this as "the deposit is covered",
  // when the ledger says every naira of it already went to the level they
  // finished.
  const charges = [
    { id: "c1", level: "A1", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(60) },
    { id: "c2", level: "A2", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(10) },
  ];
  const base = {
    totalPaid: 150_000,
    tuitionFee: 150_000,
    requiredDeposit: 90_000,
    level: "A2",
    now: NOW,
  };

  it("wrongly grants deposit access on the new level when charges is dropped", () => {
    const access = deriveStudentAccess(base); // charges omitted — falls back to the raw sum
    expect(access.hasAccess).toBe(true);
  });

  it("correctly withholds it once the ledger shows nothing paid toward A2", () => {
    const access = deriveStudentAccess({ ...base, charges });
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unpaid_deposit");
  });
});

describe("deriveStudentAccess — currentLevelPaid (the tuition-offer 'paid in full' lie)", () => {
  // Same promoted-A1-to-A2 student as above. `/api/student/tuition-offer`
  // used to compare lifetime totalPaid (₦150,000) against the A2 fee
  // (₦150,000) and declare "paid in full — certificate clean", while this
  // same ledger correctly keeps the portal locked. `currentLevelPaid` is the
  // one number both screens must read, so neither can say something the
  // other disagrees with.
  const charges = [
    { id: "c1", level: "A1", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(60) },
    { id: "c2", level: "A2", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(10) },
  ];
  const base = { totalPaid: 150_000, tuitionFee: 150_000, requiredDeposit: 90_000, level: "A2", now: NOW };

  it("is 0 toward A2 once the ledger shows every naira already went to A1", () => {
    const access = deriveStudentAccess({ ...base, charges });
    expect(access.currentLevelPaid).toBe(0);
    expect(access.totalPaid).toBe(150_000); // lifetime money is still there — just not credited to THIS level
  });

  it("falls back to the raw lifetime sum when there is no ledger (pre-rollout, exactly as before)", () => {
    const access = deriveStudentAccess(base); // charges omitted
    expect(access.currentLevelPaid).toBe(150_000);
  });

  it("equals the charge's own FIFO allocation once A2 itself is actually paid", () => {
    const access = deriveStudentAccess({ ...base, totalPaid: 300_000, charges }); // clears A1, then funds A2 in full
    expect(access.currentLevelPaid).toBe(150_000);
    expect(access.hasAccess).toBe(true);
  });
});

describe("deriveStudentAccess — omitting flatDeposit for Travel Package", () => {
  // Travel Package prices the whole pathway at once (₦980,000), but the
  // minimum first payment is a flat ₦200,000 floor, not 60% of the package.
  // A ledger charge for the full package exists; the student has paid the
  // flat floor and nothing more.
  const charges = [
    { id: "c1", level: "TRAVEL", amount: 980_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(5) },
  ];
  const base = {
    totalPaid: 200_000,
    tuitionFee: 980_000,
    requiredDeposit: 200_000,
    level: "TRAVEL",
    charges,
    now: NOW,
  };

  it("wrongly withholds access when flatDeposit is dropped (60% of 980k is demanded instead)", () => {
    const access = deriveStudentAccess(base); // flatDeposit omitted — gate becomes 60% of the ledger charge
    expect(access.hasAccess).toBe(false);
  });

  it("correctly opens access at the flat ₦200,000 floor when flatDeposit is passed", () => {
    const access = deriveStudentAccess({ ...base, flatDeposit: true });
    expect(access.hasAccess).toBe(true);
  });
});

describe("deriveStudentAccess — the upcoming-batch waiting room", () => {
  // Signed up in early September for the October intake; today is 19 Sept.
  const october = {
    tuitionFee: 150_000,
    requiredDeposit: 90_000,
    enrolledAt: new Date("2026-09-05T10:00:00Z"),
    batch: "October",
    now: new Date("2026-09-19T12:00:00Z"),
  };

  it("locks EVERY payment state until the batch opens, and says why", () => {
    for (const totalPaid of [0, 15_000, 90_000, 150_000]) {
      const access = deriveStudentAccess({ ...october, totalPaid });
      expect(access.hasAccess).toBe(false);
      expect(access.batchLocked).toBe(true);
      expect(access.lockReason).toBe("upcoming_batch");
      expect(access.batchLabel).toBe("October 2026");
      expect(access.daysUntilBatchStart).toBe(12);
    }
  });

  it("opens the portal on the first day for someone who has paid", () => {
    const access = deriveStudentAccess({ ...october, totalPaid: 150_000, now: new Date("2026-10-01T00:30:00+01:00") });
    expect(access.hasAccess).toBe(true);
    expect(access.batchLocked).toBe(false);
    expect(access.lockReason).toBeNull();
  });

  it("puts an unpaid learner behind the ordinary deposit gate once the batch has begun", () => {
    const access = deriveStudentAccess({ ...october, totalPaid: 0, now: new Date("2026-10-01T00:30:00+01:00") });
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unpaid_deposit");
  });

  it("starts a part-payer's 30-day clock at the batch, not at enrolment", () => {
    // Enrolled 5 Sept. Without the floor the balance lock would land 5 Oct —
    // four days after classes open. With it: 1 Oct + 30 days = 31 Oct.
    const during = deriveStudentAccess({ ...october, totalPaid: 90_000, now: new Date("2026-10-06T12:00:00+01:00") });
    expect(during.hasAccess).toBe(true);
    expect(during.lockAt?.slice(0, 10)).toBe("2026-10-30");
    const after = deriveStudentAccess({ ...october, totalPaid: 90_000, now: new Date("2026-11-02T12:00:00+01:00") });
    expect(after.lockReason).toBe("unsettled_balance");
  });

  it("changes nothing for a student with no batch", () => {
    const access = deriveStudentAccess({ ...october, batch: null, totalPaid: 90_000 });
    expect(access.hasAccess).toBe(true);
    expect(access.batchLocked).toBe(false);
  });

  it("does not lock an ongoing learner whose stale bare month resolves a year out", () => {
    const access = deriveStudentAccess({
      ...october,
      batch: "July",
      enrolledAt: new Date("2026-08-19T00:00:00Z"),
      totalPaid: 150_000,
    });
    expect(access.batchLocked).toBe(false);
    expect(access.hasAccess).toBe(true);
  });
});

describe("deriveStudentAccess — August money must not open October", () => {
  const a1 = {
    id: "chg-a1",
    level: "A1",
    amount: 155_000,
    waivedAmount: 0,
    legacyArrears: false,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  };

  it("keeps A2 locked when the only tuition paid is the finished A1 fee", () => {
    const access = deriveStudentAccess({
      totalPaid: 155_000,
      tuitionFee: 155_000,
      requiredDeposit: 93_000,
      level: "A2",
      charges: [a1],
    });

    expect(access.hasAccess).toBe(false);
    expect(access.depositCleared).toBe(false);
    expect(access.lockReason).toBe("unpaid_deposit");
    expect(access.outstanding).toBe(93_000);
  });

  it("opens B1 access when its payment clears the deposit and older debt is legacy arrears", () => {
    const access = deriveStudentAccess({
      totalPaid: 180_000,
      tuitionFee: 180_000,
      requiredDeposit: 108_000,
      level: "B1",
      charges: [
        {
          id: "a2",
          level: "A2",
          amount: 180_000,
          legacyArrears: true,
          createdAt: daysAgo(60),
        },
        {
          id: "b1",
          level: "B1",
          amount: 180_000,
          legacyArrears: false,
          createdAt: daysAgo(10),
        },
      ],
      payments: [
        {
          amount: 180_000,
          level: "B1",
          description: "Tuition payment (recorded by office)",
          createdAt: daysAgo(1),
        },
      ],
      now: NOW,
    });

    expect(access.hasAccess).toBe(true);
    expect(access.depositCleared).toBe(true);
    expect(access.totalPaid).toBe(180_000);
    expect(access.outstandingBalance).toBe(0);
    expect(access.lifetimeOutstanding).toBe(180_000);
  });

  it("reports B1 deposit met when older go-forward debt still locks portal access", () => {
    const access = deriveStudentAccess({
      totalPaid: 180_000,
      tuitionFee: 180_000,
      requiredDeposit: 108_000,
      level: "B1",
      charges: [
        {
          id: "a2",
          level: "A2",
          amount: 180_000,
          legacyArrears: false,
          createdAt: daysAgo(60),
        },
        {
          id: "b1",
          level: "B1",
          amount: 180_000,
          legacyArrears: false,
          createdAt: daysAgo(10),
        },
      ],
      payments: [
        {
          amount: 180_000,
          level: "B1",
          description: "Tuition payment (recorded by office)",
          createdAt: daysAgo(1),
        },
      ],
      now: NOW,
    });

    expect(access.depositCleared).toBe(true);
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unsettled_balance");
    expect(access.outstandingBalance).toBe(180_000);
  });

  it("keeps A2 locked even when an A2 charge exists and FIFO already sat the A1 fee", () => {
    const access = deriveStudentAccess({
      totalPaid: 155_000,
      tuitionFee: 155_000,
      requiredDeposit: 93_000,
      level: "A2",
      charges: [
        a1,
        {
          id: "chg-a2",
          level: "A2",
          amount: 155_000,
          waivedAmount: 0,
          legacyArrears: false,
          createdAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    });

    expect(access.hasAccess).toBe(false);
    expect(access.depositCleared).toBe(false);
  });

  it("still opens A1 when that level's own deposit is on the ledger", () => {
    const access = deriveStudentAccess({
      totalPaid: 155_000,
      tuitionFee: 155_000,
      requiredDeposit: 93_000,
      level: "A1",
      charges: [a1],
    });

    expect(access.hasAccess).toBe(true);
    expect(access.depositCleared).toBe(true);
  });
});

describe("deriveStudentAccess — tuitionFee reads the frozen charge, not a fresh price-book lookup", () => {
  // A TuitionCharge freezes its fee the moment it is raised (see
  // lib/finance/reprice.ts). If the price list is edited afterwards — A1
  // dropped from ₦180,000 to ₦150,000 — a student charged and billed at the
  // old price has paid exactly what they owed. The caller still passes the
  // CURRENT price-book figure as `tuitionFee` (that is all `tuitionFeeFor`
  // can return); this must not leak into the headline figure the dossier and
  // the student's own dashboard show, or a fully-paid student reads as
  // "₦180,000 paid of a ₦150,000 fee".
  const chargedAtOldPrice = {
    id: "c-a1",
    level: "A1",
    amount: 180_000,
    waivedAmount: 0,
    legacyArrears: false,
    createdAt: new Date("2026-09-10T00:00:00Z"),
  };

  it("shows the charge's own frozen amount, not the live price-book figure the caller passed in", () => {
    const access = deriveStudentAccess({
      totalPaid: 180_000,
      tuitionFee: 150_000, // the price list today, AFTER this student was charged
      requiredDeposit: 90_000,
      level: "A1",
      charges: [chargedAtOldPrice],
    });

    expect(access.tuitionFee).toBe(180_000);
    expect(access.totalPaid).toBe(180_000);
    expect(access.requiredDeposit).toBe(108_000);
    expect(access.hasAccess).toBe(true);
    expect(access.outstandingBalance).toBe(0);
  });

  it("falls back to the raw price-book figure when there is no charge yet for the level they are in", () => {
    const access = deriveStudentAccess({
      totalPaid: 0,
      tuitionFee: 150_000,
      requiredDeposit: 90_000,
      level: "A2",
      charges: [chargedAtOldPrice], // A1 only — nothing raised yet for A2
    });

    expect(access.tuitionFee).toBe(150_000);
  });

  it("falls back to the raw price-book figure with no ledger at all", () => {
    const access = deriveStudentAccess({
      totalPaid: 0,
      tuitionFee: 150_000,
      requiredDeposit: 90_000,
      level: "A1",
    });

    expect(access.tuitionFee).toBe(150_000);
  });
});
