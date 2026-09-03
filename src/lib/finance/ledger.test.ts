import { describe, expect, it } from "vitest";
import { buildLedger, emptyLedger, ledgerIsPopulated, type LedgerChargeInput } from "./ledger";

const NOW = new Date("2026-09-03T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function charge(overrides: Partial<LedgerChargeInput> & { id: string }): LedgerChargeInput {
  return {
    level: "A1",
    amount: 150_000,
    waivedAmount: 0,
    legacyArrears: false,
    createdAt: new Date(NOW.getTime() - 60 * DAY),
    ...overrides,
  };
}

describe("buildLedger — FIFO allocation", () => {
  it("pays the oldest charge down first", () => {
    const ledger = buildLedger(
      [
        charge({ id: "a1", level: "A1", amount: 150_000, createdAt: new Date(NOW.getTime() - 120 * DAY) }),
        charge({ id: "a2", level: "A2", amount: 150_000, createdAt: new Date(NOW.getTime() - 60 * DAY) }),
      ],
      // Enough to clear A1 and put a dent in A2.
      200_000,
      NOW,
    );

    const [a1, a2] = ledger.lines;
    expect(a1.level).toBe("A1");
    expect(a1.allocated).toBe(150_000);
    expect(a1.settled).toBe(true);
    expect(a2.level).toBe("A2");
    expect(a2.allocated).toBe(50_000);
    expect(a2.outstanding).toBe(100_000);
    expect(ledger.lifetimeOutstanding).toBe(100_000);
  });

  it("orders charges raised in the same instant by ladder position", () => {
    const sameInstant = new Date(NOW.getTime() - 10 * DAY);
    const ledger = buildLedger(
      [
        charge({ id: "b1", level: "B1", amount: 180_000, createdAt: sameInstant }),
        charge({ id: "a1", level: "A1", amount: 150_000, createdAt: sameInstant }),
        charge({ id: "a2", level: "A2", amount: 150_000, createdAt: sameInstant }),
      ],
      150_000,
      NOW,
    );

    expect(ledger.lines.map((l) => l.level)).toEqual(["A1", "A2", "B1"]);
    expect(ledger.lines[0].settled).toBe(true);
    expect(ledger.lines[1].outstanding).toBe(150_000);
  });

  it("nets waived amounts out before allocating", () => {
    const ledger = buildLedger(
      [charge({ id: "a1", amount: 150_000, waivedAmount: 50_000 })],
      100_000,
      NOW,
    );

    expect(ledger.lines[0].net).toBe(100_000);
    expect(ledger.lines[0].outstanding).toBe(0);
    expect(ledger.lifetimeCharged).toBe(100_000);
    expect(ledger.lifetimeOutstanding).toBe(0);
  });

  it("caps a waiver at the charge amount", () => {
    const ledger = buildLedger([charge({ id: "a1", amount: 150_000, waivedAmount: 999_999 })], 0, NOW);
    expect(ledger.lines[0].net).toBe(0);
    expect(ledger.lines[0].settled).toBe(true);
  });

  it("carries overpayment forward as a credit balance", () => {
    const ledger = buildLedger([charge({ id: "a1", amount: 150_000 })], 200_000, NOW);
    expect(ledger.lifetimeOutstanding).toBe(0);
    expect(ledger.creditBalance).toBe(50_000);
    expect(ledger.lifetimeAllocated).toBe(150_000);
  });

  it("normalises junk paid input to zero", () => {
    const ledger = buildLedger([charge({ id: "a1" })], Number.NaN, NOW);
    expect(ledger.lifetimePaid).toBe(0);
    expect(ledger.lines[0].outstanding).toBe(150_000);
  });
});

describe("buildLedger — go-forward vs legacy", () => {
  it("splits outstanding into go-forward and legacy buckets", () => {
    const ledger = buildLedger(
      [
        charge({ id: "a1", level: "A1", amount: 150_000, legacyArrears: true, createdAt: new Date(NOW.getTime() - 5 * DAY) }),
        charge({ id: "a2", level: "A2", amount: 150_000, legacyArrears: true, createdAt: new Date(NOW.getTime() - 5 * DAY + 1000) }),
        charge({ id: "b1", level: "B1", amount: 180_000, legacyArrears: false, createdAt: new Date(NOW.getTime() - 5 * DAY + 2000) }),
      ],
      // Clears both legacy levels, leaves B1 fully open.
      300_000,
      NOW,
    );

    expect(ledger.legacyOutstanding).toBe(0);
    expect(ledger.goForwardOutstanding).toBe(180_000);
    expect(ledger.lifetimeOutstanding).toBe(180_000);
  });

  it("reports the oldest open charge for ageing, and the oldest go-forward one for the lock", () => {
    const ledger = buildLedger(
      [
        charge({ id: "a1", level: "A1", amount: 150_000, legacyArrears: true, createdAt: new Date(NOW.getTime() - 90 * DAY) }),
        charge({ id: "b1", level: "B1", amount: 180_000, legacyArrears: false, createdAt: new Date(NOW.getTime() - 20 * DAY) }),
      ],
      0,
      NOW,
    );

    expect(ledger.oldestOpenLevel).toBe("A1");
    expect(ledger.oldestOpenAgeDays).toBe(90);
    expect(ledger.oldestOpenGoForwardLevel).toBe("B1");
    expect(ledger.oldestOpenGoForwardAgeDays).toBe(20);
  });
});

describe("emptyLedger / ledgerIsPopulated", () => {
  it("an empty ledger has nothing to say", () => {
    const ledger = emptyLedger(50_000);
    expect(ledgerIsPopulated(ledger)).toBe(false);
    expect(ledger.lifetimeOutstanding).toBe(0);
    expect(ledger.creditBalance).toBe(50_000);
  });

  it("a ledger with charges is populated", () => {
    expect(ledgerIsPopulated(buildLedger([charge({ id: "a1" })], 0, NOW))).toBe(true);
  });
});
