import type { StudentFinance } from "@/lib/finance/receivables";
import type { ChurnRisk } from "@/lib/student-risk";

/**
 * SEGMENTATION — how the office classifies "all these students" beyond a flat
 * roster: returning vs new, private vs group, alumni, at-risk, behind on
 * fees, and so on.
 *
 * Two kinds of label, deliberately kept apart:
 *
 *   - STORED tags (`Student.tags`) are admin-authored — "scholarship",
 *     "corporate", "vip" — anything the office decides by hand. Written once,
 *     read back as-is.
 *   - DERIVED segments (this file's `deriveSegments`) are computed fresh from
 *     the same facts every other screen already reads: `computeStudentFinance`
 *     from lib/finance/receivables.ts and `computeChurnRisk` from
 *     lib/student-risk.ts, passed in already-computed rather than reworked
 *     here, so a segment can never disagree with the dashboard tile it is
 *     named after.
 *
 * The roster and export treat both lists as one combined set of filter values
 * — a stored tag and a derived segment look the same to a reader clicking a
 * filter chip.
 */

/**
 * The status vocabulary actually in use across signup, the admin roster and
 * this export — not an invented replacement for it. `active`/`paused`/
 * `graduated` are what the app has always written; `withdrawn` and
 * `prospective` are new values the office can now set by hand for someone who
 * left outright or hasn't started yet, without overloading `paused` for both.
 */
export const STUDENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "graduated", label: "Graduated" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "prospective", label: "Prospective" },
] as const;

export type StudentStatusValue = (typeof STUDENT_STATUSES)[number]["value"];

export type SegmentInput = {
  status: string;
  classType: string;
  deliveryMode: string;
  heldBackAt: Date | null;
  classesStartedAt: Date | null;
  createdAt: Date;
  /**
   * How many enrolment periods this student has ever had. Phase 1 has no
   * enrolment-history table yet, so callers pass 1 for everyone except a
   * student whose record shows a prior run (see `wasEverPreviouslyActive`) —
   * this becomes exact once Phase 2's StudentEnrolment table lands.
   */
  enrolmentCount?: number;
};

export type DeriveSegmentsContext = {
  now?: Date;
  finance?: Pick<StudentFinance, "behindOnTuition" | "owed" | "progressPercent"> | null;
  risk?: Pick<ChurnRisk, "level"> | null;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * The machine-derived segment ids for one student. Every id here is also a
 * valid value for the roster's `?tag=` filter — see student-roster-query.ts.
 */
export function deriveSegments(student: SegmentInput, ctx: DeriveSegmentsContext = {}): string[] {
  const now = ctx.now ?? new Date();
  const segments: string[] = [];

  segments.push((student.enrolmentCount ?? 1) > 1 ? "returning" : "new");
  segments.push(student.classType === "private" ? "private" : "group");

  if (student.deliveryMode === "online") segments.push("online");
  else if (student.deliveryMode === "hybrid") segments.push("hybrid");
  else segments.push("campus");

  if (student.status === "graduated") segments.push("alumni");
  if (student.status === "paused") segments.push("on-hold");
  if (student.status === "withdrawn") segments.push("withdrawn");
  if (student.status === "prospective") segments.push("prospective");

  if (student.heldBackAt) segments.push("held-back");

  if (
    !student.classesStartedAt &&
    now.getTime() - student.createdAt.getTime() >= 30 * DAY
  ) {
    segments.push("not-started");
  }

  if (ctx.finance) {
    if (ctx.finance.behindOnTuition) segments.push("behind-on-fees");
    if (ctx.finance.owed <= 0) segments.push("paid-in-full");
  }

  if (ctx.risk && (ctx.risk.level === "high" || ctx.risk.level === "critical")) {
    segments.push("at-risk");
  }

  return segments;
}

/** Label shown on a filter chip / export legend for a derived segment id. */
export const SEGMENT_LABELS: Record<string, string> = {
  returning: "Returning student",
  new: "New student",
  private: "Private class",
  group: "Group class",
  online: "Online",
  hybrid: "Hybrid",
  campus: "Campus",
  alumni: "Alumni",
  "on-hold": "On hold",
  withdrawn: "Withdrawn",
  prospective: "Prospective",
  "held-back": "Held back",
  "not-started": "Not started",
  "behind-on-fees": "Behind on fees",
  "paid-in-full": "Paid in full",
  "at-risk": "At risk (going quiet)",
};

/** Every derived segment id, for building a filter dropdown alongside stored tags. */
export const DERIVED_SEGMENT_IDS = Object.keys(SEGMENT_LABELS);
