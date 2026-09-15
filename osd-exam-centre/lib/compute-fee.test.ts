import { describe, expect, it } from "vitest";
import { computeFee } from "./booking";

const session = {
  feeWholeExam: 180_000,
  modulePrices: [
    { module: "reading", price: 30_000 },
    { module: "listening", price: 30_000 },
    { module: "writing", price: 60_000 },
    { module: "speaking", price: 60_000 },
  ],
};

describe("computeFee", () => {
  it("charges the whole-exam price for [\"full\"]", () => {
    expect(computeFee(session, ["full"])).toBe(180_000);
  });

  it("sums individually-priced modules", () => {
    expect(computeFee(session, ["reading", "listening"])).toBe(60_000);
  });

  it("returns null for a module this session never priced", () => {
    expect(computeFee({ feeWholeExam: 100, modulePrices: [] }, ["reading"])).toBeNull();
  });
});
