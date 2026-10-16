import { MONTH_NAMES, monthNameToIndex } from "@/lib/batch";
import { TIME_SLOTS, type TimeSlot } from "@/lib/class-times";
import { OFFERED_LEVELS } from "@/lib/levels";

export const SIGNUP_CLOSED_SLOTS_KEY = "signup.closedSlots";

export type ClosedSignupSlot = {
  batch: string;
  year: number;
  level: string;
  sessionSlot: TimeSlot;
};

function isTimeSlot(value: unknown): value is TimeSlot {
  return typeof value === "string" && (TIME_SLOTS as readonly string[]).includes(value);
}

function isClosedSignupSlot(value: unknown): value is ClosedSignupSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Record<string, unknown>;
  const year = Number(slot.year);
  return (
    monthNameToIndex(slot.batch) !== null &&
    Number.isInteger(year) &&
    year >= new Date().getFullYear() - 1 &&
    year <= new Date().getFullYear() + 5 &&
    typeof slot.level === "string" &&
    (OFFERED_LEVELS as readonly string[]).includes(slot.level.toUpperCase()) &&
    isTimeSlot(slot.sessionSlot)
  );
}

function normalizeSlot(slot: ClosedSignupSlot): ClosedSignupSlot {
  return {
    batch: MONTH_NAMES[monthNameToIndex(slot.batch)!],
    year: Number(slot.year),
    level: slot.level.toUpperCase(),
    sessionSlot: slot.sessionSlot,
  };
}

export function parseClosedSignupSlots(value: unknown): ClosedSignupSlot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isClosedSignupSlot).map(normalizeSlot);
}

export function signupSlotIsClosed(
  closedSlots: ClosedSignupSlot[],
  selection: { batch: string; year: number; level: string; sessionSlot: string },
): boolean {
  const monthIndex = monthNameToIndex(selection.batch);
  return closedSlots.some(
    (slot) =>
      monthIndex !== null &&
      monthNameToIndex(slot.batch) === monthIndex &&
      slot.year === selection.year &&
      slot.level === selection.level.toUpperCase() &&
      slot.sessionSlot === selection.sessionSlot,
  );
}

export function validateClosedSignupSlots(value: unknown): ClosedSignupSlot[] | null {
  if (!Array.isArray(value) || !value.every(isClosedSignupSlot)) return null;
  const unique = new Map<string, ClosedSignupSlot>();
  for (const slot of value) {
    const normalized = normalizeSlot(slot);
    unique.set(
      `${normalized.batch}|${normalized.year}|${normalized.level}|${normalized.sessionSlot}`,
      normalized,
    );
  }
  return [...unique.values()];
}
