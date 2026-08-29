/**
 * The one place a score becomes a verdict.
 *
 * The pass mark and the letter scale were inline in `/api/student/results`.
 * The certificate needs exactly the same rules — a student cannot be told
 * "passed" on the results page and handed a certificate that disagrees — so
 * both now read from here.
 */

export const PASS_MARK = 60;

/**
 * The whole vocabulary of things a tutor can put a mark against, and how
 * heavily each one pulls on a student's average.
 *
 * ONE list, ONE weight map, ONE home. These strings are written into
 * `Grade.type` by the mark-entry grid and read straight back as the
 * gradebook's columns, the results page's skills, and the certificate's
 * average — so a type that is not in this list is a mark nothing downstream
 * can see, and a weight that lives in a second copy is a weight that silently
 * stops applying. `lecturer-roster.ts` re-exports these rather than keeping
 * its own copy.
 *
 * The four skills are the spine of a language course and each counts once. A
 * quiz is a quick check and counts for less; a mock exam is a dress rehearsal
 * for the real sitting and counts for more. A weight only ever applies when a
 * mark of that type actually exists — an unmarked mock does not drag anything.
 */
export const REQUIRED_ASSESSMENT_TYPES = [
  "writing",
  "reading",
  "speaking",
  "listening",
] as const;

export const OPTIONAL_ASSESSMENT_TYPES = ["classwork", "quiz", "mock exam"] as const;

export const ASSESSMENT_TYPES = [
  ...REQUIRED_ASSESSMENT_TYPES,
  ...OPTIONAL_ASSESSMENT_TYPES,
] as const;

export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const ASSESSMENT_WEIGHTS: Record<AssessmentType, number> = {
  writing: 1,
  reading: 1,
  speaking: 1,
  listening: 1,
  classwork: 1,
  quiz: 0.75,
  "mock exam": 1.75,
};

export function isAssessmentType(value: unknown): value is AssessmentType {
  return typeof value === "string" && (ASSESSMENT_TYPES as readonly string[]).includes(value);
}

export function isRequiredAssessmentType(value: unknown): value is (typeof REQUIRED_ASSESSMENT_TYPES)[number] {
  return typeof value === "string" && (REQUIRED_ASSESSMENT_TYPES as readonly string[]).includes(value);
}

/** The weight for a type, defaulting to 1 for anything not in the map. */
export function weightFor(type: string): number {
  return (ASSESSMENT_WEIGHTS as Record<string, number>)[type] ?? 1;
}

/**
 * A student's coursework average, weighted by assessment type.
 *
 * Pass ONE mark per type — the latest, if a type has been marked more than
 * once — so a tutor who marks speaking every week does not swamp a student's
 * average with speaking. Exam sittings are NOT coursework and must be filtered
 * out before calling this: they are reported on their own, against the pass
 * mark, never averaged in. Returns null when there is nothing to average, so
 * "not marked yet" never renders as a zero.
 */
export function weightedCourseworkAverage(
  marks: ReadonlyArray<{ type: string; score: number }>,
): number | null {
  if (marks.length === 0) return null;
  let weighted = 0;
  let weight = 0;
  for (const mark of marks) {
    const w = weightFor(mark.type);
    weighted += mark.score * w;
    weight += w;
  }
  return weight > 0 ? Math.round(weighted / weight) : null;
}

export function letterFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= PASS_MARK) return "D";
  return "F";
}

export function hasPassed(score: number | null | undefined): boolean {
  return typeof score === "number" && score >= PASS_MARK;
}

/**
 * The award band printed on a certificate.
 *
 * Tiering is deliberate: a single flat "Pass" gives a student who scored 88
 * nothing to show for it, and gives the student who scored 61 nothing to aim at
 * next level. The bands are the same ones the letter grades already imply, so
 * they cannot contradict the results page.
 */
export type Award = "distinction" | "merit" | "pass" | "participation";

export const AWARD_LABELS: Record<Award, string> = {
  distinction: "with Distinction",
  merit: "with Merit",
  pass: "Pass",
  participation: "Course Participation",
};

export function awardFor(score: number | null | undefined): Award {
  if (typeof score !== "number") return "participation";
  if (score >= 85) return "distinction";
  if (score >= 70) return "merit";
  if (score >= PASS_MARK) return "pass";
  return "participation";
}
