/**
 * WHO IS ACTUALLY USING THE LMS — BY AGE.
 *
 * The school suspects older learners struggle with the portal more than the
 * young ones do, but had no way to see it: birth dates sit in two places (the
 * typed `StudentProfile.dateOfBirth` and the legacy `admission.dob` string,
 * which is often free-typed DD/MM/YYYY) and nothing ever added them up.
 *
 * This is the one place that turns a birth date into an age and an age into a
 * band, so the admin report, the "check in on" list and any future filter all
 * agree. Pure on purpose — no I/O — so it is unit-tested without a database.
 *
 * A birth date is personal data. Everything downstream of here works in bands
 * and counts; the report never prints a birth date.
 */

import { profileFromAdmissionBlob } from "@/lib/student-profile";

export const AGE_BANDS = [
  { key: "under18", label: "Under 18", min: 0, max: 17 },
  { key: "18-24", label: "18 – 24", min: 18, max: 24 },
  { key: "25-34", label: "25 – 34", min: 25, max: 34 },
  { key: "35-44", label: "35 – 44", min: 35, max: 44 },
  { key: "45-54", label: "45 – 54", min: 45, max: 54 },
  { key: "55+", label: "55 and over", min: 55, max: 200 },
] as const;

export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

/** From this age up, "does the portal work for them?" is worth asking on purpose. */
export const OLDER_LEARNER_MIN_AGE = 45;

/** Below this or above that, a birth date is a typo, not a person. */
const MIN_PLAUSIBLE_AGE = 4;
const MAX_PLAUSIBLE_AGE = 100;

/**
 * Whole years between a birth date and `now`, or null when the date is missing
 * or cannot be a real learner (in the future, or over a century old — usually
 * a swapped day/month or a default like 1900-01-01 rather than a person).
 */
export function ageFromDob(dob: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const date = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(date.getTime())) return null;

  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;

  if (age < MIN_PLAUSIBLE_AGE || age > MAX_PLAUSIBLE_AGE) return null;
  return age;
}

export function ageBandOf(age: number | null | undefined): AgeBandKey | null {
  if (age === null || age === undefined || !Number.isFinite(age)) return null;
  const band = AGE_BANDS.find((b) => age >= b.min && age <= b.max);
  return band ? band.key : null;
}

/**
 * The student's birth date from whichever place holds it: the typed column
 * first, then the legacy admission blob (which the shared profile parser
 * already reads, DD/MM/YYYY included).
 */
export function dobOfStudent(
  profile: { dateOfBirth?: Date | string | null } | null | undefined,
  admission: unknown,
): Date | null {
  if (profile?.dateOfBirth) {
    const typed = profile.dateOfBirth instanceof Date ? profile.dateOfBirth : new Date(profile.dateOfBirth);
    if (!Number.isNaN(typed.getTime())) return typed;
  }
  return profileFromAdmissionBlob(admission).dateOfBirth ?? null;
}

export type AgeRow = {
  age: number | null;
  /** 0–1, or null when there is nothing to average. */
  attendanceRate: number | null;
  /** 0–100, or null when there is nothing to average. */
  progressPercent: number | null;
};

export type AgeBandSummary = {
  key: AgeBandKey;
  label: string;
  count: number;
  /** Share of the students whose age is known, 0–100. */
  sharePercent: number;
  /** Mean attendance across the band's students that have any marks, 0–100. */
  avgAttendancePercent: number | null;
  /** Mean course progress across the band's students that have any, 0–100. */
  avgProgressPercent: number | null;
};

export type AgeSummary = {
  total: number;
  known: number;
  unknown: number;
  averageAge: number | null;
  medianAge: number | null;
  olderCount: number;
  olderSharePercent: number;
  bands: AgeBandSummary[];
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summariseAges(rows: AgeRow[]): AgeSummary {
  const known = rows.filter((r) => r.age !== null) as (AgeRow & { age: number })[];
  const ages = known.map((r) => r.age);

  const bands: AgeBandSummary[] = AGE_BANDS.map((band) => {
    const inBand = known.filter((r) => r.age >= band.min && r.age <= band.max);
    const attendance = inBand.map((r) => r.attendanceRate).filter((v): v is number => v !== null);
    const progress = inBand.map((r) => r.progressPercent).filter((v): v is number => v !== null);
    const avgAttendance = mean(attendance);
    const avgProgress = mean(progress);
    return {
      key: band.key,
      label: band.label,
      count: inBand.length,
      sharePercent: known.length ? round1((inBand.length / known.length) * 100) : 0,
      avgAttendancePercent: avgAttendance === null ? null : Math.round(avgAttendance * 100),
      avgProgressPercent: avgProgress === null ? null : Math.round(avgProgress),
    };
  });

  const older = known.filter((r) => r.age >= OLDER_LEARNER_MIN_AGE).length;
  const averageAge = mean(ages);

  return {
    total: rows.length,
    known: known.length,
    unknown: rows.length - known.length,
    averageAge: averageAge === null ? null : round1(averageAge),
    medianAge: median(ages),
    olderCount: older,
    olderSharePercent: known.length ? round1((older / known.length) * 100) : 0,
    bands,
  };
}
