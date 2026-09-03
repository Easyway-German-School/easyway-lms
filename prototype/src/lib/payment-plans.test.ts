import { describe, expect, it } from "vitest";
import { evaluatePlanAdherence, normaliseInstallments, planSuppressesLock } from "./payment-plans";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

describe("normaliseInstallments", () => {
  it("drops junk rows and sorts by due date", () => {
    const rows = normaliseInstallments([
      { dueOn: at(14), amount: 20_000 },
      { dueOn: "not a date", amount: 5_000 },
      { dueOn: at(0), amount: 0 },
      { dueOn: at(7), amount: 20_000 },
    ]);
    expect(rows.map((r) => r.amount)).toEqual([20_000, 20_000]);
    expect(new Date(rows[0].dueOn) < new Date(rows[1].dueOn)).toBe(true);
  });
});

describe("evaluatePlanAdherence", () => {
  const plan = {
    installments: [
      { dueOn: at(-10), amount: 20_000 },
      { dueOn: at(-3), amount: 20_000 },
      { dueOn: at(7), amount: 20_000 },
    ],
    startingPaid: 100_000,
    graceDays: 3,
  };

  it("is on_track when payments keep up with what is due", () => {
    // Two instalments due (the -3 one is within its 3-day grace, so not yet
    // counted... actually -3 + 3 = today, so it IS due). ₦40k due, ₦40k paid.
    const a = evaluatePlanAdherence(plan, 140_000, NOW);
    expect(a.dueByNow).toBe(40_000);
    expect(a.paidSincePlan).toBe(40_000);
    expect(a.shortfall).toBe(0);
    expect(a.status).toBe("on_track");
    expect(planSuppressesLock(a)).toBe(true);
  });

  it("is behind when a due instalment is unpaid past its grace", () => {
    const a = evaluatePlanAdherence(plan, 120_000, NOW); // only ₦20k paid
    expect(a.shortfall).toBe(20_000);
    expect(a.status).toBe("behind");
    expect(planSuppressesLock(a)).toBe(false);
  });

  it("respects the grace window on a just-passed instalment", () => {
    const graceful = {
      ...plan,
      installments: [{ dueOn: at(-1), amount: 20_000 }], // due yesterday, 3-day grace
    };
    const a = evaluatePlanAdherence(graceful, 100_000, NOW); // nothing paid yet
    expect(a.dueByNow).toBe(0); // still inside grace
    expect(a.status).toBe("on_track");
  });

  it("is completed once the whole plan total is covered", () => {
    const a = evaluatePlanAdherence(plan, 100_000 + 60_000, NOW);
    expect(a.status).toBe("completed");
    expect(planSuppressesLock(a)).toBe(true);
  });

  it("measures only payments made since the plan started", () => {
    const a = evaluatePlanAdherence(plan, 100_000, NOW); // paid nothing new
    expect(a.paidSincePlan).toBe(0);
    expect(a.status).toBe("behind");
  });
});
