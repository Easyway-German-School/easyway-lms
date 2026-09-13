import { describe, expect, it } from "vitest";
import { mayJoinAnyLiveCohort } from "./live-presence";

describe("mayJoinAnyLiveCohort", () => {
  it("allows hybrid and online students to cross over into any live cohort at their level", () => {
    expect(mayJoinAnyLiveCohort("hybrid")).toBe(true);
    expect(mayJoinAnyLiveCohort("online")).toBe(true);
    expect(mayJoinAnyLiveCohort("physical")).toBe(false);
    expect(mayJoinAnyLiveCohort(undefined)).toBe(false);
  });
});
