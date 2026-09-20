import { describe, expect, it } from "vitest";
import { nameMatchScore, rankNameMatches } from "./student-name-match";

describe("nameMatchScore", () => {
  it("finds a learner whatever order the words come in", () => {
    expect(nameMatchScore("Agwazie Chioma Patience", "Agwazie Chioma Patience")).toBe(1);
    expect(nameMatchScore("Chioma Agwazie", "Agwazie Chioma Patience")).toBe(1);
  });

  it("copes with hyphens and stored names that carry extra words", () => {
    expect(nameMatchScore("Onyema-Isichie Adaobi", "Adaobi Onyema Isichie")).toBe(1);
    expect(
      nameMatchScore("Chioma Obichukwu", "Chioma Chidera Obichukwu A2 PHYSICAL MORNING CLASS Stream 1"),
    ).toBe(1);
  });

  it("forgives one typo in a longer word", () => {
    expect(nameMatchScore("Rabie Damilare", "Rabbie Damilare")).toBeGreaterThan(0.8);
  });

  it("does not match when a word asked for is missing", () => {
    expect(nameMatchScore("Jimoh Ethel", "Ethel Okafor")).toBe(0);
    expect(nameMatchScore("Jimoh Ethel", "Jimoh Tunde")).toBe(0);
  });

  it("does not trust a single word as much as a full name", () => {
    expect(nameMatchScore("Chioma", "Agwazie Chioma Patience")).toBeLessThan(0.7);
  });
});

describe("rankNameMatches", () => {
  it("puts the closest learner first", () => {
    const pool = [
      { name: "Chioma Okoro" },
      { name: "Agwazie Chioma Patience" },
      { name: "Threasa Chioma Nwankwo" },
    ];
    const ranked = rankNameMatches("Agwazie Chioma", pool, (p) => p.name);
    expect(ranked[0].item.name).toBe("Agwazie Chioma Patience");
    expect(ranked).toHaveLength(1);
  });
});
