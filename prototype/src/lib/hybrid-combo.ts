/**
 * Every hybrid combo a student can pick at signup: which physical sitting
 * they attend on campus, paired with which online sitting they drop into
 * over video.
 *
 * "Hybrid" used to be a single vague mode — registered at a campus, and
 * somehow also allowed to drop into any online sitting of their level. That
 * vagueness is exactly what let one online tutor's coverage pattern sweep in
 * students who were never meant to be theirs: nothing pinned a hybrid
 * student to one concrete online sitting, so nothing could match them to one
 * concrete online tutor either.
 *
 * A hybrid student now picks ONE of these named combos, which is what fixes
 * that — `Student.sessionSlot` stores the physical half (same column every
 * physical/online-only student already uses), `hybridOnlineSlot` stores the
 * online half. What was fixed was picking a CONCRETE pair, not which pairs
 * are offered: this is every physical sitting paired with every online
 * sitting the school runs (physical has four; online only ever runs morning
 * and evening — see session-times.ts), so "physical morning + online
 * evening" and the rest are all real options here, not just the three the
 * office happened to name first. The signup form and the retroactive
 * "pick your sittings" popup both then filter this down further to whatever
 * is actually open for the student's level (see isCellEnabled in
 * school-settings.ts) — this list is every pairing that could exist, not
 * every pairing that does right now.
 *
 * No prisma import: the signup form and the Becca popup both need this in
 * the browser.
 */

const PHYSICAL_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;
const ONLINE_SLOTS = ["morning", "evening"] as const;

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

const PAIRED_COMBOS: readonly HybridCombo[] = PHYSICAL_SLOTS.flatMap((physicalSlot) =>
  ONLINE_SLOTS.map((onlineSlot) => ({
    id: `physical-${physicalSlot}_online-${onlineSlot}`,
    physicalSlot,
    onlineSlot,
    label: `Physical ${titleCase(physicalSlot)} + Online ${titleCase(onlineSlot)}`,
  })),
);

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
