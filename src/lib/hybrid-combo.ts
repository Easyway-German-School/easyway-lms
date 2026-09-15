/**
 * The fixed set of hybrid combos a student can pick at signup.
 *
 * "Hybrid" used to be a single vague mode — registered at a campus, and
 * somehow also allowed to drop into any online sitting of their level. That
 * vagueness is exactly what let one online tutor's coverage pattern sweep in
 * students who were never meant to be theirs: nothing pinned a hybrid
 * student to one concrete online sitting, so nothing could match them to one
 * concrete online tutor either.
 *
 * A hybrid student now picks ONE of these named combos: which physical
 * sitting they attend on campus, and which online sitting they drop into
 * over video. `Student.sessionSlot` stores the physical half (same column
 * every physical/online-only student already uses), `hybridOnlineSlot`
 * stores the online half.
 *
 * Deliberately a short, curated list rather than every physical × online
 * cross product — three real timetable slots the office actually runs,
 * plus an escape hatch for anything else. No prisma import: the signup form
 * and the Becca popup both need this in the browser.
 */

export type HybridComboId =
  | "physical-morning_online-morning"
  | "physical-evening_online-evening"
  | "physical-afternoon_online-evening"
  | "other";

export type HybridCombo = {
  id: HybridComboId;
  physicalSlot: "morning" | "afternoon" | "evening" | "weekend" | null;
  onlineSlot: "morning" | "evening" | null;
  label: string;
};

export const HYBRID_COMBOS: readonly HybridCombo[] = [
  {
    id: "physical-morning_online-morning",
    physicalSlot: "morning",
    onlineSlot: "morning",
    label: "Physical morning + Online morning",
  },
  {
    id: "physical-evening_online-evening",
    physicalSlot: "evening",
    onlineSlot: "evening",
    label: "Physical evening + Online evening",
  },
  {
    id: "physical-afternoon_online-evening",
    physicalSlot: "afternoon",
    onlineSlot: "evening",
    label: "Physical afternoon + Online evening",
  },
  {
    id: "other",
    physicalSlot: null,
    onlineSlot: null,
    label: "Not sure yet — start me on a sitting",
  },
] as const;

export const HYBRID_COMBO_IDS = HYBRID_COMBOS.map((combo) => combo.id) as HybridComboId[];

export function findHybridCombo(id: unknown): HybridCombo | null {
  const key = String(id ?? "").trim();
  return HYBRID_COMBOS.find((combo) => combo.id === key) ?? null;
}

/**
 * The combo used for a student who picked "Other" (or nothing) — a
 * genuinely unsure student still needs a real tutor from day one, so this is
 * NOT a "leave them unassigned" escape hatch. It's the same rule-based match
 * everyone else gets, just against a picked-for-them default: the first
 * curated combo whose both halves still run for their level, or the first
 * combo outright if the settings can't be read. The student is flagged (see
 * `Student.admission.hybridComboWasDefaulted`) so the office and
 * HybridComboMoment both know to offer them a real choice, but that flag
 * never blocks assignment — it only prompts a later correction.
 */
export function fallbackHybridCombo(
  isSlotOpen: (level: string | null | undefined, slot: string, mode: "hybrid" | "online") => boolean,
  level: string | null | undefined,
): HybridCombo {
  const real = HYBRID_COMBOS.filter((combo) => combo.id !== "other");
  const open = real.find(
    (combo) => isSlotOpen(level, combo.physicalSlot!, "hybrid") && isSlotOpen(level, combo.onlineSlot!, "online"),
  );
  return open ?? real[0];
}

/** The combo a student's stored slots correspond to, for re-showing their choice. */
export function comboForSlots(sessionSlot: unknown, hybridOnlineSlot: unknown): HybridCombo | null {
  const physical = String(sessionSlot ?? "").toLowerCase();
  const online = String(hybridOnlineSlot ?? "").toLowerCase();
  if (!online) return null;
  return (
    HYBRID_COMBOS.find((combo) => combo.physicalSlot === physical && combo.onlineSlot === online) ?? null
  );
}
