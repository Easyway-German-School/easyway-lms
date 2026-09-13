import { describe, expect, it } from "vitest";
import { mayJoinAnyLiveCohort } from "./live-presence";

describe("mayJoinAnyLiveCohort", () => {
  it("allows only hybrid students to cross over into any live cohort at their level", () => {
    expect(mayJoinAnyLiveCohort("hybrid")).toBe(true);
    expect(mayJoinAnyLiveCohort("online")).toBe(false);
    expect(mayJoinAnyLiveCohort("physical")).toBe(false);
    expect(mayJoinAnyLiveCohort(undefined)).toBe(false);
  });
});
