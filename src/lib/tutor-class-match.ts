/**
 * THE RULE THAT DECIDES HOW A STUDENT GETS LINKED TO A TUTOR.
 *
 * Two questions used to be answered in three different places, slightly
 * differently each time (the tutor's edit panel, the coverage preview, the
 * signup auto-assigner):
 *
 *   1. Does this student FIT what this tutor teaches?   (branch, level,
 *      sitting, intake month, delivery mode)
 *   2. If so, HOW should they be linked?                (primary tutor, or an
 *      extra co-tutor alongside the tutor they already have)
 *
 * This module is the single answer to both. It is pure — no prisma, no I/O —
 * so the admin panel, the bulk-link route and the tests all run the same code.
 *
 * SEATS. A student occupies one or two "seats", and a tutor fits a student if
 * their coverage matches ANY seat:
 *   physical  → one campus seat   (student.branchId + sessionSlot)
 *   online    → one online seat   (online branch  + sessionSlot)
 *   private   → one one-to-one seat
 *   hybrid    → two seats: the campus half AND the online half
 *               (online branch + hybridOnlineSlot)
 * The old SQL match only ever looked at the campus fields, so the online half
 * of a hybrid student was invisible to online tutors.
 *
 * THE LINKING RULE (never guesses, never silently replaces anybody):
 *   - already on this tutor              → linked   (nothing to do)
 *   - fits, and has NO primary tutor     → add_primary
 *   - fits, has a primary, and is online / the online half of a hybrid
 *                                        → add_co_tutor  (keep the current
 *                                          tutor, add this one beside them)
 *   - fits, physical, has a primary      → shares_class (both tutors already
 *                                          see them through the class; a
 *                                          physical student keeps one named
 *                                          tutor unless the office moves them)
 *   - fits, private, has a primary       → conflict (one-to-one has one tutor)
 *   - would be a co-tutor but the school's "more than one tutor" switch is
 *     off and the student already has an extra tutor → blocked
 *   - doesn't fit any seat               → no_fit
 */

import {
  assignmentMatchesStudent,
  isAssigned,
  type LecturerAssignment,
  type SeatClassType,
} from "@/lib/lecturer-assignment";

export type Seat = "campus" | "online" | "private";

/** The role stored on a `StudentCoTutor` row — which half of a hybrid combo it covers. */
export type CoTutorRole = "online" | null;

export type LinkAction =
  | "linked"
  | "add_primary"
  | "add_co_tutor"
  | "shares_class"
  | "conflict"
  | "blocked"
  | "no_fit";

export type LinkStudent = {
  id: string;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  hybridOnlineSlot?: string | null;
  admission?: unknown;
  tutorId: string | null;
  coTutorIds: string[];
};

export type LinkPlan = {
  action: LinkAction;
  /** Which seat made this tutor a fit. Absent for `no_fit`. */
  seat?: Seat;
  /** Role to store on a new co-tutor row. */
  role?: CoTutorRole;
  /** Plain-language reason, safe to show the office as-is. */
  reason: string;
};

type SeatSpec = {
  seat: Seat;
  classType: SeatClassType;
  branchId: string | null;
  sessionSlot: string;
};

/** The seats this student occupies. Empty seats (no slot yet) are dropped rather than guessed. */
export function seatsFor(student: LinkStudent, onlineBranchId: string | null): SeatSpec[] {
  const seats: SeatSpec[] = [];

  if (student.classType === "private") {
    if (student.sessionSlot) {
      seats.push({ seat: "private", classType: "private", branchId: student.branchId, sessionSlot: student.sessionSlot });
    }
    return seats;
  }

  if (student.deliveryMode === "hybrid") {
    if (student.sessionSlot) {
      seats.push({ seat: "campus", classType: "physical", branchId: student.branchId, sessionSlot: student.sessionSlot });
    }
    if (student.hybridOnlineSlot && onlineBranchId) {
      seats.push({ seat: "online", classType: "online", branchId: onlineBranchId, sessionSlot: student.hybridOnlineSlot });
    }
    return seats;
  }

  if (student.deliveryMode === "online") {
    const branchId = student.branchId ?? onlineBranchId;
    if (student.sessionSlot) seats.push({ seat: "online", classType: "online", branchId, sessionSlot: student.sessionSlot });
    return seats;
  }

  if (student.sessionSlot) {
    seats.push({ seat: "campus", classType: "physical", branchId: student.branchId, sessionSlot: student.sessionSlot });
  }
  return seats;
}

/** The first seat of this student that the tutor's coverage reaches, or null. */
export function fittingSeat(
  assignment: LecturerAssignment,
  student: LinkStudent,
  onlineBranchId: string | null,
): Seat | null {
  if (!isAssigned(assignment)) return null;
  for (const spec of seatsFor(student, onlineBranchId)) {
    if (
      assignmentMatchesStudent(assignment, spec.classType, {
        branchId: spec.branchId,
        level: student.level,
        sessionSlot: spec.sessionSlot,
        admission: student.admission,
      })
    ) {
      return spec.seat;
    }
  }
  return null;
}

/**
 * May one more co-tutor go on this student? With the school's "more than one
 * tutor per student" switch on, yes. With it off, the existing one-tutor rescue
 * valve still allows a SINGLE extra tutor (see api/admin/students PATCH) — so
 * a student with no extra tutor yet can take one, and a second is refused.
 */
export function canAddCoTutor(sharedStudentsEnabled: boolean, currentCoTutorCount: number): boolean {
  return sharedStudentsEnabled || currentCoTutorCount === 0;
}

export function planLink(input: {
  lecturerId: string;
  assignment: LecturerAssignment;
  student: LinkStudent;
  onlineBranchId: string | null;
  sharedStudentsEnabled: boolean;
}): LinkPlan {
  const { lecturerId, assignment, student, onlineBranchId, sharedStudentsEnabled } = input;

  if (student.tutorId === lecturerId || student.coTutorIds.includes(lecturerId)) {
    return { action: "linked", reason: "Already assigned to this tutor." };
  }

  const seat = fittingSeat(assignment, student, onlineBranchId);
  if (!seat) {
    return { action: "no_fit", reason: "Not in the level, sitting, batch or branch this tutor teaches." };
  }

  const hasPrimary = Boolean(student.tutorId);

  if (!hasPrimary && seat !== "online") {
    return { action: "add_primary", seat, reason: "Fits this class and has no tutor yet." };
  }

  // The online half of a hybrid student is an EXTRA tutor by convention: the
  // campus tutor stays primary, the online tutor is a co-tutor tagged "online".
  if (seat === "online" && student.deliveryMode === "hybrid") {
    if (!canAddCoTutor(sharedStudentsEnabled, student.coTutorIds.length)) {
      return {
        action: "blocked",
        seat,
        reason: "This student already has an extra tutor and the school's multi-tutor setting is off.",
      };
    }
    return { action: "add_co_tutor", seat, role: "online", reason: "Fits the online half of their hybrid class." };
  }

  if (!hasPrimary) {
    return { action: "add_primary", seat, reason: "Fits this class and has no tutor yet." };
  }

  if (seat === "online") {
    if (!canAddCoTutor(sharedStudentsEnabled, student.coTutorIds.length)) {
      return {
        action: "blocked",
        seat,
        reason: "This student already has an extra tutor and the school's multi-tutor setting is off.",
      };
    }
    return { action: "add_co_tutor", seat, role: null, reason: "Already has a tutor — this one is added beside them." };
  }

  if (seat === "private") {
    return {
      action: "conflict",
      seat,
      reason: "A one-to-one student has one tutor. Move them only if the office means to.",
    };
  }

  return {
    action: "shares_class",
    seat,
    reason: "Already taught in this class alongside their named tutor. Move them only if the office means to.",
  };
}

/** What the "Link all" button will actually do — only the two automatic actions write anything. */
export const AUTO_LINK_ACTIONS: readonly LinkAction[] = ["add_primary", "add_co_tutor"];

export function isAutoLinkable(action: LinkAction): boolean {
  return AUTO_LINK_ACTIONS.includes(action);
}

const ACTION_ORDER: Record<LinkAction, number> = {
  add_primary: 0,
  add_co_tutor: 1,
  blocked: 2,
  conflict: 3,
  shares_class: 4,
  linked: 5,
  no_fit: 6,
};

/** Unlinked-and-actionable first, already-linked last — the order the office works down the list in. */
export function compareByAction(a: LinkAction, b: LinkAction): number {
  return ACTION_ORDER[a] - ACTION_ORDER[b];
}

export type LinkSummary = Record<LinkAction, number>;

export function summarizePlans(plans: Array<{ action: LinkAction }>): LinkSummary {
  const summary: LinkSummary = {
    linked: 0,
    add_primary: 0,
    add_co_tutor: 0,
    shares_class: 0,
    conflict: 0,
    blocked: 0,
    no_fit: 0,
  };
  for (const plan of plans) summary[plan.action] += 1;
  return summary;
}
