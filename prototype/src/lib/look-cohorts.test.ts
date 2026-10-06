import { describe, expect, it } from "vitest";

import { summariseLookCohorts, type CohortRow } from "@/lib/look-cohorts";
import { DEFAULT_LOOK_WAVE } from "@/lib/youth-look";

const row = (over: Partial<CohortRow>): CohortRow => ({ age: 20, choice: null, prompted: false, ...over });

describe("summariseLookCohorts", () => {
  it("sorts students into the wave and the offered", () => {
    const s = summariseLookCohorts(
      [row({ age: 17 }), row({ age: 22 }), row({ age: 29 }), row({ age: 51 }), row({ age: null })],
      DEFAULT_LOOK_WAVE,
    );
    expect(s).toMatchObject({ total: 5, wave: 2, invited: 3, seeingNew: 2, seeingClassic: 3 });
  });

  it("counts people who chose for themselves, and where they chose against their cohort", () => {
    const s = summariseLookCohorts(
      [
        row({ age: 19, choice: "classic" }), // wave, went back
        row({ age: 19 }),
        row({ age: 30, choice: "youth" }), // offered, took it
        row({ age: 60, choice: "youth" }), // offered, took it
      ],
      DEFAULT_LOOK_WAVE,
    );
    expect(s.chose).toEqual({ youth: 2, classic: 1 });
    expect(s.waveWentBack).toBe(1);
    expect(s.invitedTookIt).toBe(2);
    expect(s.seeingNew).toBe(3); // the wave student who stayed + the two who tried it
  });

  it("counts how many have seen Becca's popup", () => {
    expect(summariseLookCohorts([row({ prompted: true }), row({}), row({ prompted: true })], DEFAULT_LOOK_WAVE).prompted).toBe(2);
  });

  it("moves with the wave, so the admin can preview a change", () => {
    const rows = [row({ age: 20 }), row({ age: 28 }), row({ age: 33 })];
    expect(summariseLookCohorts(rows, DEFAULT_LOOK_WAVE).wave).toBe(1);
    expect(summariseLookCohorts(rows, { ...DEFAULT_LOOK_WAVE, maxAge: 34 }).wave).toBe(3);
  });

  it("handles an empty school", () => {
    expect(summariseLookCohorts([], DEFAULT_LOOK_WAVE).total).toBe(0);
  });
});
