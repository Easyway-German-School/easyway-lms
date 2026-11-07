/**
 * The hybrid sittings a student can pick: one class time, attended on campus
 * and over video. Hybrid is one shared class, not two separately timed classes.
 *
 * "Hybrid" used to be a single vague mode — registered at a campus, and
 * somehow also allowed to drop into any online sitting of their level. That
 * vagueness is exactly what let one online tutor's coverage pattern sweep in
 * students who were never meant to be theirs: nothing pinned a hybrid
 * student to one concrete online sitting, so nothing could match them to one
 * concrete online tutor either.
 *
 * New hybrid registrations can choose only matching morning/morning or
 * evening/evening slots. Existing student records are not changed here.
 * The signup form and the retroactive "pick your sittings" popup filter these
 * choices further to whatever is open for the student's level.
 *
 * No prisma import: the signup form and the Becca popup both need this in
 * the browser.
 */

const HYBRID_SLOTS = ["morning", "evening"] as const;

export type HybridComboId = string;

export type HybridCombo = {
  id: HybridComboId;
  physicalSlot: "morning" | "afternoon" | "evening" | "weekend" | null;
  onlineSlot: "morning" | "evening" | null;
  label: string;
};

function titleCase(slot: string): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

const PAIRED_COMBOS: readonly HybridCombo[] = HYBRID_SLOTS.map((slot) => ({
  id: `physical-${slot}_online-${slot}`,
  physicalSlot: slot,
  onlineSlot: slot,
  label: `Physical ${titleCase(slot)} + Online ${titleCase(slot)}`,
}));

export const HYBRID_COMBOS: readonly HybridCombo[] = [
  ...PAIRED_COMBOS,
  {
    id: "other",
    physicalSlot: null,
    onlineSlot: null,
    label: "Not sure yet — start me on a sitting",
  },
];

export const HYBRID_COMBO_IDS = HYBRID_COMBOS.map((combo) => combo.id) as HybridComboId[];
export const HYBRID_SESSION_SLOTS = HYBRID_SLOTS;

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
