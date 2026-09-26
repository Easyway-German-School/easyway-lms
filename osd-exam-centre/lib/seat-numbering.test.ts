import { describe, expect, it } from "vitest";
import { seatNumberForIndex } from "./seat-numbering";

describe("seatNumberForIndex", () => {
  it("counts down from 50 to 1 for the first block", () => {
    expect(seatNumberForIndex(0)).toBe(50);
    expect(seatNumberForIndex(1)).toBe(49);
    expect(seatNumberForIndex(49)).toBe(1);
  });

  it("counts down from 100 to 51 for the second block", () => {
    expect(seatNumberForIndex(50)).toBe(100);
    expect(seatNumberForIndex(99)).toBe(51);
  });

  it("counts down from 150 to 101 for the third block", () => {
    expect(seatNumberForIndex(100)).toBe(150);
    expect(seatNumberForIndex(149)).toBe(101);
  });

  it("never repeats a seat number across the first 200 candidates", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const seat = seatNumberForIndex(i);
      expect(seen.has(seat)).toBe(false);
      seen.add(seat);
    }
  });
});
