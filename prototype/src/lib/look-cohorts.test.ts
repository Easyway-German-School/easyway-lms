import { describe, expect, it } from "vitest";

import { summariseLookCohorts, type CohortRow } from "@/lib/look-cohorts";
import { DEFAULT_LOOK_WAVE } from "@/lib/youth-look";

const row = (over: Partial<CohortRow>): CohortRow => ({ age: 20, choice: null, prompted: false, ...over });

describe("summariseLookCohorts", () => {
  it("counts every student in the universal look rollout regardless of age", () => {
    const s = summariseLookCohorts(
      [row({ age: 17 }), row({ age: 22 }), row({ age: 29 }), row({ age: 51 }), row({ age: null })],
      DEFAULT_LOOK_WAVE,
    );
    expect(s).toMatchObject({ total: 5, wave: 5, invited: 0, seeingNew: 5, seeingClassic: 0 });
  });

  it("counts saved choices without letting a classic preference override the universal look", () => {
    const s = summariseLookCohorts(
      [
        row({ age: 19, choice: "classic" }),
        row({ age: 19 }),
        row({ age: 30, choice: "youth" }),
        row({ age: 60, choice: "youth" }),
      ],
      DEFAULT_LOOK_WAVE,
    );
    expect(s.chose).toEqual({ youth: 2, classic: 1 });
    expect(s.waveWentBack).toBe(1);
    expect(s.invitedTookIt).toBe(0);
    expect(s.seeingNew).toBe(4);
    expect(s.seeingClassic).toBe(0);
  });

  it("counts how many have seen Becca's popup", () => {
    expect(summariseLookCohorts([row({ prompted: true }), row({}), row({ prompted: true })], DEFAULT_LOOK_WAVE).prompted).toBe(2);
  });

  it("does not move students between age cohorts when a legacy wave setting changes", () => {
    const rows = [row({ age: 20 }), row({ age: 28 }), row({ age: 33 })];
    expect(summariseLookCohorts(rows, DEFAULT_LOOK_WAVE).wave).toBe(3);
    expect(summariseLookCohorts(rows, { ...DEFAULT_LOOK_WAVE, maxAge: 34 }).wave).toBe(3);
  });

  it("handles an empty school", () => {
    expect(summariseLookCohorts([], DEFAULT_LOOK_WAVE).total).toBe(0);
  });
});
