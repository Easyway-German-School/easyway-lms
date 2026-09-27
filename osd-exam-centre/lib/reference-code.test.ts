import { describe, expect, it } from "vitest";
import { generateReferenceCode } from "./reference-code";

describe("generateReferenceCode", () => {
  it("matches the EW-OSD-<year>-<5 chars> shape with no ambiguous characters", () => {
    const code = generateReferenceCode(2026);
    expect(code).toMatch(/^EW-OSD-2026-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it("is not realistically guessable in a handful of tries", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateReferenceCode(2026)));
    // 1000 draws from a 32^5 ≈ 33.5M space colliding would indicate a broken RNG, not chance.
    expect(codes.size).toBe(1000);
  });
});
