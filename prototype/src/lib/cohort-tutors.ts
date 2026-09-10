import {
  SESSION_SLOTS,
  readAssignment,
  teachingGroups,
  type AssignmentSource,
} from "@/lib/lecturer-assignment";
import { LECTURER_STATUS_META, readLecturerStatus } from "@/lib/lecturer-status";

/**
 * Who teaches a group cohort, resolved from lecturer assignments.
 *
 * A cohort is branch + level + sitting (`branchId:LEVEL:slot`). A tutor covers
 * it when their assignment does; the tutor's own `classTypes` decides which
 * side of a hybrid cohort — the in-person room or the video room — they take.
 * `classTypes` unset means "the whole class" (`both`), which is how every tutor
 * created before that field existed reads.
 *
 * Shared by the admin "Who teaches each class" panel (which needs the full
 * campus/online split) and the student + parent timetable (which just needs a
 * name to show next to each class).
 */

export type CohortRole = "campus" | "online" | "both";

/** The subset of a Lecturer row this module reads. */
export type LecturerLike = AssignmentSource & {
  id: string;
  status?: unknown;
  user?: { name: string | null } | null;
};

export type CohortTeacher = {
  lecturerId: string;
  name: string;
  status: string;
  assignable: boolean;
  role: CohortRole;
  /** `branchId:LEVEL:slot` keys this tutor teaches (all-sitting groups expanded). */
  cohortKeys: string[];
};

/** Which side(s) of a hybrid cohort this tutor's class-type setting covers. */
export function cohortRoleOf(classTypes: string[]): CohortRole | null {
  const set = new Set(classTypes.map((value) => value.toLowerCase()));
  const groupRoles = [...set].filter((value) => value !== "private");
  if (groupRoles.length === 0) return set.has("private") ? null : "both";
  const hasPhysical = groupRoles.includes("physical");
  const hasOnline = groupRoles.includes("online");
  if (hasPhysical && hasOnline) return "both";
  if (hasPhysical) return "campus";
  if (hasOnline) return "online";
  return null;
}

/**
 * Turn raw lecturer rows into one `CohortTeacher` per group tutor. Private-only
 * tutors and unassigned tutors drop out. `branchNames` is only used for labels
 * downstream — pass an empty map when you just need the cohort keys.
 */
export function buildCohortTeachers(
  lecturers: LecturerLike[],
  branchNames: Map<string, string> = new Map(),
): CohortTeacher[] {
  const out: CohortTeacher[] = [];
  for (const lecturer of lecturers) {
    const assignment = readAssignment(lecturer);
    const role = cohortRoleOf(assignment.classTypes);
    if (!role) continue;

    const cohortKeys = new Set<string>();
    for (const group of teachingGroups(assignment, branchNames)) {
      const base = `${group.branchId}:${group.level.toUpperCase()}`;
      if (group.sessionSlot) cohortKeys.add(`${base}:${group.sessionSlot.toLowerCase()}`);
      else for (const slot of SESSION_SLOTS) cohortKeys.add(`${base}:${slot}`);
    }
    if (cohortKeys.size === 0) continue;

    const status = readLecturerStatus(lecturer.status);
    out.push({
      lecturerId: lecturer.id,
      name: lecturer.user?.name ?? "Unnamed tutor",
      status,
      assignable: LECTURER_STATUS_META[status].assignable,
      role,
      cohortKeys: [...cohortKeys],
    });
  }
  return out;
}

/**
 * The tutor name to show a student for their cohort, picked by how they attend:
 * an online student sees the online tutor, a campus student the in-person one,
 * a hybrid student the online tutor (their usual way in) falling back to
 * campus. `both`-role tutors and, failing everything, any assigned tutor fill
 * the gaps. Returns null when nobody assignable covers the cohort.
 */
export function tutorNameForStudentCohort(
  teachers: CohortTeacher[],
  cohortKey: string,
  deliveryMode: string | null | undefined,
): string | null {
  const here = teachers.filter((t) => t.assignable && t.cohortKeys.includes(cohortKey));
  if (!here.length) return null;

  const mode = (deliveryMode ?? "physical").toLowerCase();
  const wantRole: CohortRole = mode === "online" || mode === "hybrid" ? "online" : "campus";

  const exact = here.filter((t) => t.role === wantRole);
  const both = here.filter((t) => t.role === "both");
  const fallbackRole: CohortRole = wantRole === "online" ? "campus" : "online";
  const other = here.filter((t) => t.role === fallbackRole);

  const pool = exact.length ? exact : both.length ? both : other.length ? other : here;
  return pool[0]?.name ?? null;
}
