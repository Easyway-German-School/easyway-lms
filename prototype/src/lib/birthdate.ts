/**
 * The birth-date input's arithmetic, kept out of the component so it can be
 * tested. The wizard asks for Day · Month · Year as three plain boxes (see
 * BirthdateInput in components/ProfileDetailsPrompt.tsx) and stores ISO.
 */

import { ageFromDob } from "@/lib/age-bands";

export type DobParts = { day: string; month: string; year: string };

/** "YYYY-MM-DD" (or a legacy "DD/MM/YYYY") → its three parts, blank when it is neither. */
export function splitDob(value: string): DobParts {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: iso[1], month: String(Number(iso[2])), day: String(Number(iso[3])) };
  const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return { day: String(Number(dmy[1])), month: String(Number(dmy[2])), year: dmy[3] };
  return { day: "", month: "", year: "" };
}

/** Three plain boxes to ISO, or "" unless it is a real calendar date for a plausible learner. */
export function joinDob(day: string, month: string, year: string, now: Date = new Date()): string {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!d || !m || !/^\d{4}$/.test(year)) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  // JS rolls 31 February into March instead of failing; a round-trip catches it.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  if (ageFromDob(date, now) === null) return "";
  return date.toISOString().slice(0, 10);
}
