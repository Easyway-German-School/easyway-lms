import { describe, expect, it } from "vitest";

import { DECK } from "@/lib/duel-deck";
import {
  DUEL_QUESTIONS,
  decideOutcome,
  deckLevelOf,
  isFinished,
  lowerLevel,
  pickQuestions,
  pointsFor,
  publicQuestion,
  scoreAnswer,
  totalPoints,
  type DuelAnswer,
} from "@/lib/duel";

describe("the deck", () => {
  it("has enough words at every level to run many different duels", () => {
    for (const level of ["A1", "A2", "B1", "B2"] as const) expect(DECK[level].length).toBeGreaterThanOrEqual(30);
  });

  it("has no noun twice within a level, and only real articles", () => {
    for (const level of ["A1", "A2", "B1", "B2"] as const) {
      const nouns = DECK[level].map(([, noun]) => noun);
      expect(new Set(nouns).size).toBe(nouns.length);
      for (const [article] of DECK[level]) expect(["der", "die", "das"]).toContain(article);
    }
  });

  it("uses endings that fix the gender, as a self-check on the data", () => {
    // Words ending in these are (almost) always the article shown — a typo here is a wrong lesson.
    const rules: Array<[RegExp, string]> = [
      [/(ung|heit|keit|schaft|tät|ion)$/, "die"],
      [/(chen|lein|ment|um)$/, "das"],
      [/(ismus|ling)$/, "der"],
    ];
    for (const level of ["A1", "A2", "B1", "B2"] as const) {
      for (const [article, noun] of DECK[level]) {
        for (const [pattern, expected] of rules) {
          if (pattern.test(noun)) expect(article, `${noun} should be ${expected}`).toBe(expected);
        }
      }
    }
  });
});

describe("levels", () => {
  it("maps C1/C2 to the hardest deck and unknowns to the easiest", () => {
    expect(deckLevelOf("C1")).toBe("B2");
    expect(deckLevelOf("c2")).toBe("B2");
    expect(deckLevelOf("B1")).toBe("B1");
    expect(deckLevelOf(null)).toBe("A1");
    expect(deckLevelOf("banana")).toBe("A1");
  });

  it("plays the lower level of the two", () => {
    expect(lowerLevel("A2", "B2")).toBe("A2");
    expect(lowerLevel("C1", "B1")).toBe("B1");
    expect(lowerLevel("B1", "B1")).toBe("B1");
  });
});

describe("pickQuestions", () => {
  it("is deterministic for a seed and different for another", () => {
    expect(pickQuestions("A1", "duel-1")).toEqual(pickQuestions("A1", "duel-1"));
    expect(pickQuestions("A1", "duel-1")).not.toEqual(pickQuestions("A1", "duel-2"));
  });

  it("gives the full round of distinct nouns", () => {
    const qs = pickQuestions("B1", "abc");
    expect(qs).toHaveLength(DUEL_QUESTIONS);
    expect(new Set(qs.map((q) => q.noun)).size).toBe(DUEL_QUESTIONS);
  });

  it("never lets one article be more than half the round, so tapping the same button cannot win", () => {
    for (let i = 0; i < 40; i += 1) {
      const qs = pickQuestions("A2", `seed-${i}`);
      for (const article of ["der", "die", "das"]) {
        expect(qs.filter((q) => q.article === article).length).toBeLessThanOrEqual(DUEL_QUESTIONS / 2);
      }
    }
  });

  it("never reveals the answer in the public form", () => {
    const pub = publicQuestion(pickQuestions("A1", "x")[0]);
    expect(Object.keys(pub).sort()).toEqual(["gloss", "noun"]);
  });
});

describe("scoring", () => {
  it("scores nothing for a wrong answer, however fast", () => {
    expect(pointsFor(false, 300)).toBe(0);
  });

  it("scores 100 plus a speed bonus for a right one, and the bonus fades to nothing", () => {
    expect(pointsFor(true, 300)).toBe(100 + 50 - 1); // 300ms -> 1 step off the max
    expect(pointsFor(true, 2000)).toBe(100 + 40);
    expect(pointsFor(true, 12_000)).toBe(100);
  });

  it("clamps absurd timings so a tampered 0ms cannot win by bonus alone", () => {
    expect(pointsFor(true, 0)).toBe(pointsFor(true, 250));
    expect(pointsFor(true, Number.NaN)).toBe(100);
    expect(pointsFor(true, -50)).toBe(pointsFor(true, 250));
  });

  it("judges an answer against the frozen question on the server side", () => {
    const q = { noun: "Tisch", gloss: "table", article: "der" as const };
    expect(scoreAnswer(q, 0, "der", 1000).correct).toBe(true);
    expect(scoreAnswer(q, 0, "die", 1000)).toMatchObject({ correct: false, points: 0 });
  });
});

describe("outcome", () => {
  const mk = (points: number[]): DuelAnswer[] =>
    points.map((p, i) => ({ i, choice: "der", correct: p > 0, ms: 1000, points: p }));
  const full = (p: number) => mk(Array(DUEL_QUESTIONS).fill(p));

  it("is not decided until both players have finished", () => {
    expect(decideOutcome({ answersA: full(100), answersB: null, playerAId: "a", playerBId: "b" })).toEqual({ done: false });
    expect(decideOutcome({ answersA: full(100), answersB: mk([100, 100]), playerAId: "a", playerBId: "b" })).toEqual({ done: false });
  });

  it("names the higher scorer the winner", () => {
    const out = decideOutcome({ answersA: full(120), answersB: full(100), playerAId: "a", playerBId: "b" });
    expect(out).toMatchObject({ done: true, winnerId: "a", draw: false, pointsA: 960, pointsB: 800 });
    expect(decideOutcome({ answersA: full(100), answersB: full(120), playerAId: "a", playerBId: "b" })).toMatchObject({ winnerId: "b" });
  });

  it("calls an exact tie a draw with no winner", () => {
    expect(decideOutcome({ answersA: full(100), answersB: full(100), playerAId: "a", playerBId: "b" })).toMatchObject({
      done: true,
      winnerId: null,
      draw: true,
    });
  });

  it("totals and finish checks tolerate missing data", () => {
    expect(totalPoints(null)).toBe(0);
    expect(isFinished(null)).toBe(false);
    expect(isFinished(full(1))).toBe(true);
  });
});
