import { describe, expect, it } from "vitest";
import { buildWortbauRounds, buildWortsuche, dailySeed, scoreWortbauWord } from "@/lib/word-puzzles";
import { isMonthDumpWindow, schoolCalendarParts } from "@/lib/month-dump-window";

describe("word puzzles", () => {
  it("builds five Wortbau rounds with matching tile letters", () => {
    const rounds = buildWortbauRounds("A1", "test-seed", 5);
    expect(rounds).toHaveLength(5);
    for (const round of rounds) {
      expect(round.tiles.sort().join("")).toBe(round.target.word.split("").sort().join(""));
      expect(round.target.gloss.length).toBeGreaterThan(0);
    }
  });

  it("prefers material words when provided", () => {
    const rounds = buildWortbauRounds("A1", "mat-seed", 2, [
      { word: "Bahnhof", gloss: "station", article: "der" },
      { word: "Wohnung", gloss: "flat", article: "die" },
    ]);
    expect(rounds.map((r) => r.target.word)).toEqual(expect.arrayContaining(["BAHNHOF", "WOHNUNG"]));
  });

  it("places Wortsuche words on the grid", () => {
    const puzzle = buildWortsuche("A2", "grid-seed");
    expect(puzzle.words.length).toBeGreaterThan(0);
    expect(puzzle.grid).toHaveLength(puzzle.size);
    for (const word of puzzle.words) {
      const cells = puzzle.placements[word.word];
      expect(cells?.length).toBe(word.word.length);
      const spelled = cells!.map((c) => puzzle.grid[c.r][c.c]).join("");
      expect([spelled, [...spelled].reverse().join("")]).toContain(word.word);
    }
  });

  it("scores longer words higher", () => {
    expect(scoreWortbauWord("HAUS")).toBeGreaterThan(scoreWortbauWord("EI"));
  });

  it("names a stable daily seed", () => {
    expect(dailySeed(new Date("2026-11-28T12:00:00Z"))).toMatch(/2026-11-28/);
  });
});

describe("month dump window", () => {
  it("opens in the last five days of the month", () => {
    expect(isMonthDumpWindow(new Date("2026-11-28T12:00:00Z"))).toBe(true);
    expect(isMonthDumpWindow(new Date("2026-11-10T12:00:00Z"))).toBe(false);
  });

  it("labels November correctly", () => {
    const parts = schoolCalendarParts(new Date("2026-11-28T12:00:00Z"));
    expect(parts.monthLabel).toBe("November");
    expect(parts.year).toBe(2026);
  });
});
