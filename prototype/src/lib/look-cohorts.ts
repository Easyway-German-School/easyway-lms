/**
 * HOW MANY STUDENTS EACH LOOK RULE REACHES — for the admin to see BEFORE
 * moving the age cutoff, not after.
 *
 * Counts only; never a name and never a birth date, the same rule the age
 * report follows. Pure, so it is tested without a database.
 */

import { resolveLook, type Look, type LookWave } from "@/lib/youth-look";

export type CohortRow = {
  age: number | null;
  choice: Look | null;
  prompted: boolean;
};

export type CohortSummary = {
  total: number;
  /** Rule-based cohorts, before anyone's own choice. */
  wave: number;
  invited: number;
  /** What students are actually seeing right now, choices included. */
  seeingNew: number;
  seeingClassic: number;
  /** Students who picked for themselves. */
  chose: { youth: number; classic: number };
  /** Of the wave, how many went back to classic — the number that says whether the look is landing. */
  waveWentBack: number;
  /** Of the invited, how many tried it. */
  invitedTookIt: number;
  /** How many have been shown Becca's popup. */
  prompted: number;
};

export function summariseLookCohorts(rows: CohortRow[], wave: LookWave): CohortSummary {
  const out: CohortSummary = {
    total: rows.length,
    wave: 0,
    invited: 0,
    seeingNew: 0,
    seeingClassic: 0,
    chose: { youth: 0, classic: 0 },
    waveWentBack: 0,
    invitedTookIt: 0,
    prompted: 0,
  };

  for (const row of rows) {
    const decision = resolveLook({ age: row.age, choice: row.choice, wave });
    out[decision.cohort] += 1;
    if (decision.look === "youth") out.seeingNew += 1;
    else out.seeingClassic += 1;
    if (row.choice) out.chose[row.choice] += 1;
    if (decision.cohort === "wave" && row.choice === "classic") out.waveWentBack += 1;
    if (decision.cohort === "invited" && row.choice === "youth") out.invitedTookIt += 1;
    if (row.prompted) out.prompted += 1;
  }

  return out;
}
