/**
 * Whether a tutor is currently teaching, and on what terms.
 *
 * Tutors leave. They go on maternity leave, they finish a contract, they are
 * suspended, they resign mid-term. Until now the only way to record any of
 * that was to delete the account, which took the tutor off every class they
 * had ever taught and every mark they had ever entered — so nobody did it, and
 * the tutor list slowly filled with people who no longer work here.
 *
 * A status is not a deletion. The account, the history and the marks all stay
 * exactly where they are; what changes is whether the person can sign in and
 * whether the office should be handing them a class.
 */

export const LECTURER_STATUSES = ["active", "probation", "on_leave", "inactive"] as const;
export type LecturerStatus = (typeof LECTURER_STATUSES)[number];

export const DEFAULT_LECTURER_STATUS: LecturerStatus = "active";

type StatusMeta = {
  label: string;
  /** Shown under the badge in the admin list, so the choice is unambiguous. */
  description: string;
  /** Can this person sign in to the tutor portal? */
  canSignIn: boolean;
  /** Should the office be giving this person new classes? */
  assignable: boolean;
  /** Tailwind classes for the badge. */
  tone: string;
};

export const LECTURER_STATUS_META: Record<LecturerStatus, StatusMeta> = {
  active: {
    label: "Active",
    description: "Teaching now. Appears everywhere, can sign in.",
    canSignIn: true,
    assignable: true,
    tone: "bg-emerald-500/10 text-emerald-700",
  },
  probation: {
    label: "Probation",
    description: "New or under review. Works normally — this is a flag for the office, not a restriction.",
    canSignIn: true,
    assignable: true,
    tone: "bg-sky-500/10 text-sky-700",
  },
  on_leave: {
    label: "On leave",
    description: "Away but coming back. Keeps their account and their classes; should not be given new ones.",
    // Deliberately still true: somebody on leave may need their own timetable
    // and their own marks, and locking them out is how a return goes wrong.
    canSignIn: true,
    assignable: false,
    tone: "bg-amber-500/15 text-amber-800",
  },
  inactive: {
    label: "Inactive",
    description: "No longer teaches here. Cannot sign in. History, marks and past classes are kept.",
    canSignIn: false,
    assignable: false,
    tone: "bg-rose-500/10 text-rose-700",
  },
};

/**
 * Employment terms. Separate from status on purpose: a part-time tutor is not
 * a less-active one, and folding the two into a single field is how you end up
 * unable to say "part-time and on leave".
 */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "visiting"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  visiting: "Visiting",
};

export function isLecturerStatus(value: unknown): value is LecturerStatus {
  return typeof value === "string" && (LECTURER_STATUSES as readonly string[]).includes(value);
}

export function isEmploymentType(value: unknown): value is EmploymentType {
  return typeof value === "string" && (EMPLOYMENT_TYPES as readonly string[]).includes(value);
}

/** Anything unrecognised — including null on rows that predate this — is active. */
export function readLecturerStatus(value: unknown): LecturerStatus {
  return isLecturerStatus(value) ? value : DEFAULT_LECTURER_STATUS;
}

export function lecturerCanSignIn(value: unknown): boolean {
  return LECTURER_STATUS_META[readLecturerStatus(value)].canSignIn;
}

export function lecturerIsAssignable(value: unknown): boolean {
  return LECTURER_STATUS_META[readLecturerStatus(value)].assignable;
}

export function lecturerStatusLabel(value: unknown): string {
  return LECTURER_STATUS_META[readLecturerStatus(value)].label;
}
