import { monthNameToIndex } from "@/lib/batch";

/**
 * The sweep: "who really belongs to the August batch, and why is each of them (not)
 * on the lists?"
 *
 * The desk lists a learner only when their batch label is exactly a month name the
 * calendar can read. A learner labelled "Aug", mistyped, or with no label at all is
 * invisible there, and nothing says so. The sweep ignores the label as the ONLY
 * evidence: it looks at every learner in the school, collects everyone with ANY sign
 * of belonging to the batch (label, history record, first-day date, registration
 * month), and gives each one a single plain reason.
 *
 * Pure — no database. The server feeds it facts; it hands back a verdict, so "who
 * belongs" and "what do we call them" can never be answered two ways.
 */

export type SweepReason =
  | "on_desk"
  | "moved_up"
  | "still_running"
  | "not_active"
  | "top_level"
  | "other_batch"
  | "unreadable_label"
  | "no_label_strong"
  | "no_label_weak";

/** Display order, and the words an admin reads. */
export const SWEEP_ORDER: SweepReason[] = [
  "on_desk",
  "moved_up",
  "no_label_strong",
  "no_label_weak",
  "unreadable_label",
  "other_batch",
  "still_running",
  "not_active",
  "top_level",
];

export const SWEEP_LABEL: Record<SweepReason, string> = {
  on_desk: "On the lists above",
  moved_up: "Already moved up",
  no_label_strong: "No batch on their record, but they clearly were in it — can be added",
  no_label_weak: "No batch on their record; only their registration month points here — check by hand",
  unreadable_label: "Batch written in a way the system cannot read — check by hand",
  other_batch: "Recorded in a different batch — check by hand",
  still_running: "Batch has not finished yet for them (e.g. weekend sitting)",
  not_active: "Not an active learner (withdrawn, paused…)",
  top_level: "Already at the top level",
};

export type SweepInput = {
  /** The batch being swept, as a month name ("August"). */
  month: string;
  status: string;
  hasNextLevel: boolean;
  /** `admission.batch` exactly as stored, or null. */
  label: string | null;
  /** Signed off on a level below the one they are on now. */
  movedUp: boolean;
  /** Where they are now, for the "already moved" line. */
  levelNow: string;
  /** The desk lists them right now. */
  onDesk: boolean;
  /** Their batch label is the month AND the desk does not list them: when their batch ends, or null if unreadable. */
  endsOn: string | null;
  signals: {
    /** A history row for this student is in that month. */
    history: boolean;
    /** Their first confirmed day is in that month. */
    started: boolean;
    /** They registered in that month. */
    registered: boolean;
  };
};

export type SweepVerdict = {
  belongs: boolean;
  reason: SweepReason;
  detail: string;
  /** Plain reasons we think they belong here. */
  evidence: string[];
};

export function classifySweep(input: SweepInput): SweepVerdict {
  const wanted = monthNameToIndex(input.month);
  const labelIndex = monthNameToIndex(input.label);
  const labelMatches = wanted !== null && labelIndex === wanted;

  const evidence: string[] = [];
  if (labelMatches) evidence.push(`batch on record is ${input.month}`);
  if (input.signals.history) evidence.push(`their level history is in ${input.month}`);
  if (input.signals.started) evidence.push(`first day was in ${input.month}`);
  if (input.signals.registered) evidence.push(`registered in ${input.month}`);

  const strong = input.signals.history || input.signals.started;
  const belongs = labelMatches || strong || input.signals.registered;
  if (!belongs) return { belongs: false, reason: "on_desk", detail: "", evidence };

  const done = (reason: SweepReason, detail: string): SweepVerdict => ({ belongs: true, reason, detail, evidence });

  if (input.status !== "active") return done("not_active", `Status: ${input.status}`);
  if (input.movedUp) return done("moved_up", `Now on ${input.levelNow}`);
  if (!input.hasNextLevel) return done("top_level", `Level ${input.levelNow}`);
  if (input.onDesk) return done("on_desk", "");

  if (labelMatches) {
    return input.endsOn
      ? done("still_running", `Their batch ends ${input.endsOn}`)
      : done("unreadable_label", `Batch on record: "${input.label}"`);
  }
  if (input.label && labelIndex === null) return done("unreadable_label", `Batch on record: "${input.label}"`);
  if (input.label) return done("other_batch", `Batch on record: ${input.label}`);
  return done(strong ? "no_label_strong" : "no_label_weak", "No batch on record");
}

/** The calendar year of the most recent occurrence of `month` that has already begun. */
export function sweepYear(monthIndex: number, nowYear: number, nowMonthIndex: number): number {
  return nowMonthIndex >= monthIndex ? nowYear : nowYear - 1;
}
