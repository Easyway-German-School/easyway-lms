import { describe, expect, it } from "vitest";
import { secureCompare } from "./secure-compare";

describe("secureCompare", () => {
  it("returns true for identical strings", () => {
    expect(secureCompare("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(secureCompare("hunter2", "hunter3")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(secureCompare("short", "a-lot-longer")).toBe(false);
  });

  it("returns false against an empty string", () => {
    expect(secureCompare("", "nonempty")).toBe(false);
  });
});
