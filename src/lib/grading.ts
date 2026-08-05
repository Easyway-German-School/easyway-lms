/**
 * The one place a score becomes a verdict.
 *
 * The pass mark and the letter scale were inline in `/api/student/results`.
 * The certificate needs exactly the same rules — a student cannot be told
 * "passed" on the results page and handed a certificate that disagrees — so
 * both now read from here.
 */

export const PASS_MARK = 60;

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
