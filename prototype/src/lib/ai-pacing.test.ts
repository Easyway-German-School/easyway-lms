import { describe, expect, it } from "vitest";
import { groqPacingWaitMs } from "./ai";

/**
 * Groq's free tier allows ~8,000 tokens a minute per model. The class-notes queue
 * and the handout queue used to spend each other's minute and fall back to worse
 * output; every call now books its tokens first and waits for room.
 */
describe("groqPacingWaitMs", () => {
  const NOW = 1_000_000;

  it("lets a request through when the minute has room", () => {
    expect(groqPacingWaitMs([], 5_000, NOW)).toBe(0);
    expect(groqPacingWaitMs([{ at: NOW - 1_000, tokens: 1_500 }], 5_000, NOW)).toBe(0);
  });

  it("waits until enough of the window has aged out", () => {
    // 6,000 used 20s ago; another 5,000 will not fit until that ages out (40s from now).
    const wait = groqPacingWaitMs([{ at: NOW - 20_000, tokens: 6_000 }], 5_000, NOW);
    expect(wait).toBe(40_000);
  });

  it("only waits for as much as it must — an older, smaller entry may free enough", () => {
    const entries = [
      { at: NOW - 50_000, tokens: 3_000 }, // ages out in 10s
      { at: NOW - 5_000, tokens: 1_500 },
    ];
    expect(groqPacingWaitMs(entries, 4_000, NOW)).toBe(10_000);
  });

  it("ignores entries older than a minute", () => {
    expect(groqPacingWaitMs([{ at: NOW - 61_000, tokens: 7_000 }], 6_000, NOW)).toBe(0);
  });

  it("does not wait for a request that can never fit — Groq will refuse it outright", () => {
    expect(groqPacingWaitMs([{ at: NOW - 1_000, tokens: 6_000 }], 20_000, NOW)).toBe(0);
  });
});
