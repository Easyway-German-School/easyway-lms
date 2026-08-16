/**
 * What a tutor teaches — one definition, used by every side of it.
 *
 * A tutor's class used to be a single branch + level + session that the tutor
 * set on themselves. Two things were wrong with that. A tutor who takes A1 and
 * A2 at Lagos and Port Harcourt could only ever be recorded as taking one of
 * them, so their other students were invisible to them. And letting a tutor
 * choose their own branch meant the school had no reliable answer to "who
 * teaches this class?" — anyone could reassign themselves at any moment.
 *
 * So the assignment is a set of lists, and it belongs to the admin. Everything
 * downstream — the roster, attendance, grading, announcements, the timetable —
 * reads it through `studentWhereForAssignment` so those views can never drift
 * apart from each other.
 *
 * No prisma import: the admin form and the tutor portal both need the
 * vocabularies below, and a server-only dependency would stop them reaching
 * the browser.
 */

export const COURSE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const SESSION_SLOTS = ["morning", "afternoon", "evening"] as const;

/**
 * How a class is delivered. Distinct from `Student.classType` (group/private),
 * which answers a different question — this one is about the room.
 */
export const CLASS_TYPES = ["physical", "online", "private"] as const;

export const BATCHES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type CourseLevel = (typeof COURSE_LEVELS)[number];
export type SessionSlot = (typeof SESSION_SLOTS)[number];
export type ClassType = (typeof CLASS_TYPES)[number];
export type Batch = (typeof BATCHES)[number];

export type LecturerAssignment = {
  branchIds: string[];
  levels: string[];
  sessionSlots: string[];
  classTypes: string[];
  batches: string[];
};

/** The shape this reads from — a Lecturer row, or a plain object in a form. */
export type AssignmentSource = {
  branchId?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  branchIds?: unknown;
  levels?: unknown;
  sessionSlots?: unknown;
  classTypes?: unknown;
  batches?: unknown;
};

/**
 * Coerce a JSON column into a clean list of allowed values.
 *
 * `allowed` being optional matters: branch ids are cuids and cannot be checked
 * against a fixed list, while every other field is a closed vocabulary and a
 * value outside it is a bug we would rather drop than store.
 */
function readList(raw: unknown, allowed?: readonly string[]): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const cleaned = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  const checked = allowed
    ? cleaned.filter((value) => allowed.some((option) => option.toLowerCase() === value.toLowerCase()))
    : cleaned;

  // Case-insensitive de-duplication, keeping the canonical spelling where
  // there is one — "MORNING" and "morning" are the same sitting.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of checked) {
    const canonical = allowed?.find((option) => option.toLowerCase() === value.toLowerCase()) ?? value;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * Read a lecturer's assignment, falling back to the legacy single-class
 * columns when the arrays have never been set.
 *
 * The fallback is what stops this migration breaking anybody: a tutor created
 * before multi-assignment existed has `branchIds = null` and a `branchId`, and
 * comes out of here with a one-element list that behaves exactly as before.
 */
export function readAssignment(source: AssignmentSource | null | undefined): LecturerAssignment {
  if (!source) {
    return { branchIds: [], levels: [], sessionSlots: [], classTypes: [], batches: [] };
  }

  const branchIds = readList(source.branchIds);
  const levels = readList(source.levels, COURSE_LEVELS);
  const sessionSlots = readList(source.sessionSlots, SESSION_SLOTS);

  return {
    branchIds: branchIds.length ? branchIds : source.branchId ? [source.branchId] : [],
    levels: levels.length ? levels : source.level ? readList([source.level], COURSE_LEVELS) : [],
    sessionSlots: sessionSlots.length
      ? sessionSlots
      : source.sessionSlot
        ? readList([source.sessionSlot], SESSION_SLOTS)
        : [],
    classTypes: readList(source.classTypes, CLASS_TYPES),
    batches: readList(source.batches, BATCHES),
  };
}

/** A tutor with no branch or no level has no class, and so has no students. */
export function isAssigned(assignment: LecturerAssignment): boolean {
  return assignment.branchIds.length > 0 && assignment.levels.length > 0;
}

/**
 * Turn an assignment into the Prisma `where` that finds its students.
 *
 * The rule each list follows: **an empty list means "no restriction"**, not
 * "matches nothing". A tutor assigned to Lagos + A1 with no sitting chosen
 * takes every A1 sitting at Lagos, which is what an admin who left the field
 * alone plainly meant. Branch and level are the exception — with neither of
 * those there is no class at all, and `isAssigned` refuses the query.
 *
 * Batches live inside the `admission` JSON blob, which SQLite cannot filter
 * on, so they are applied in `matchesBatch` after the rows come back.
 */
export function studentWhereForAssignment(assignment: LecturerAssignment): Record<string, unknown> | null {
  if (!isAssigned(assignment)) return null;

  const where: Record<string, unknown> = {
    branchId: { in: assignment.branchIds },
    level: { in: assignment.levels },
  };

  if (assignment.sessionSlots.length) {
    where.sessionSlot = { in: assignment.sessionSlots };
  }

  // "physical" and "online" describe how a class is delivered and map onto the
  // student's deliveryMode; "private" maps onto their classType. A tutor who
  // takes private students only should not see the group cohort, and vice
  // versa. Selecting all three (or none) restricts nothing.
  const types = assignment.classTypes.map((type) => type.toLowerCase());
  if (types.length && types.length < CLASS_TYPES.length) {
    const clauses: Array<Record<string, unknown>> = [];
    if (types.includes("physical")) clauses.push({ classType: "group", deliveryMode: { in: ["physical", "hybrid"] } });
    if (types.includes("online")) clauses.push({ classType: "group", deliveryMode: { in: ["online", "hybrid"] } });
    if (types.includes("private")) clauses.push({ classType: "private" });
    if (clauses.length) where.OR = clauses;
  }

  return where;
}

/**
 * Turn an assignment into the Prisma `where` that finds the community rooms it
 * covers. A `Space` only carries branch + level + session, so this is a
 * narrower cousin of `studentWhereForAssignment` — no classType/batch clauses,
 * because a room is not one of those things. Same "empty list = no
 * restriction, empty branch/level = unassigned" rule, for the same reason: a
 * tutor left with no sitting chosen still only teaches Lagos A1, all sittings.
 */
export function spaceWhereForAssignment(assignment: LecturerAssignment): Record<string, unknown> | null {
  if (!isAssigned(assignment)) return null;

  const where: Record<string, unknown> = {
    branchId: { in: assignment.branchIds },
    level: { in: assignment.levels },
  };

  if (assignment.sessionSlots.length) {
    where.sessionSlot = { in: assignment.sessionSlots };
  }

  return where;
}

/**
 * The whole roster: the class an admin described, PLUS anybody the office put
 * on this tutor by name.
 *
 * WHY THERE ARE TWO ROUTES IN. The assignment above describes a class — Lagos,
 * A2, morning — and finds its students by matching. That is right for the
 * ordinary case and wrong for every exception: a student who moved sitting
 * mid-term, an online student in a cohort nobody else takes, a one-to-one
 * pairing, a tutor covering one named person while a colleague is away. None
 * of those can be expressed as a rule over branch + level, and before this the
 * office had no way to say them at all — a tutor created for one student saw
 * an empty roster and concluded the portal was broken.
 *
 * `Student.tutorId` is that second route. It was already in the schema, and
 * already written by the private-class pairing screen, but nothing on the
 * reading side ever looked at it: the column set a tutor who could not see
 * them. This is the join that makes it mean something.
 *
 * A named student is IN, whatever the assignment says. The office naming
 * somebody is a deliberate act and outranks a pattern match — a rule that let
 * the branch filter overrule it would silently drop precisely the students who
 * needed naming in the first place.
 */
export function studentWhereForLecturer(
  assignment: LecturerAssignment,
  lecturerId?: string | null,
): Record<string, unknown> | null {
  const cohort = studentWhereForAssignment(assignment);
  const named = lecturerId ? { tutorId: lecturerId } : null;

  if (cohort && named) return { OR: [cohort, named] };
  return cohort ?? named;
}

/**
 * The in-memory half of the same question, applied after the rows come back.
 *
 * Batch cannot be filtered in SQL (it lives in the admission JSON), so it runs
 * here — and a named student must skip that filter too, for the same reason
 * they skip the branch one. Callers must select `tutorId` for this to work;
 * without it every named student silently falls through to the batch check.
 */
export function belongsToLecturer(
  assignment: LecturerAssignment,
  lecturerId: string | null | undefined,
  student: { tutorId?: string | null; admission?: unknown },
): boolean {
  if (lecturerId && student.tutorId && student.tutorId === lecturerId) return true;
  return matchesBatch(assignment, student.admission);
}

/** Batch lives in the admission JSON, so it is filtered in memory. */
export function matchesBatch(assignment: LecturerAssignment, admission: unknown): boolean {
  if (!assignment.batches.length) return true;
  const record = admission && typeof admission === "object" ? (admission as Record<string, unknown>) : {};
  const batch = typeof record.batch === "string" ? record.batch.toLowerCase() : "";
  if (!batch) return false;
  return assignment.batches.some((option) => option.toLowerCase() === batch);
}

/**
 * Normalise whatever an admin form submitted into the columns to write.
 *
 * Returns the arrays **and** the three primary mirrors, so a caller cannot
 * update one without the other and leave a tutor whose live room points at a
 * branch they no longer teach at.
 */
export function assignmentToData(input: {
  branchIds?: unknown;
  levels?: unknown;
  sessionSlots?: unknown;
  classTypes?: unknown;
  batches?: unknown;
}) {
  const branchIds = readList(input.branchIds);
  const levels = readList(input.levels, COURSE_LEVELS);
  const sessionSlots = readList(input.sessionSlots, SESSION_SLOTS);
  const classTypes = readList(input.classTypes, CLASS_TYPES);
  const batches = readList(input.batches, BATCHES);

  return {
    branchIds,
    levels,
    sessionSlots,
    classTypes,
    batches,
    branchId: branchIds[0] ?? null,
    level: levels[0] ?? null,
    sessionSlot: sessionSlots[0] ?? null,
  };
}

/** Human summary for a roster header or an admin table row. */
export function describeAssignment(
  assignment: LecturerAssignment,
  branchNames: Map<string, string>,
): string {
  if (!isAssigned(assignment)) return "No class assigned";

  const branches = assignment.branchIds.map((id) => branchNames.get(id) ?? "Unknown branch").join(", ");
  const levels = assignment.levels.join(", ");
  const slots = assignment.sessionSlots.length
    ? assignment.sessionSlots.map((slot) => slot.charAt(0).toUpperCase() + slot.slice(1)).join(", ")
    : "All sittings";

  return `${branches} · ${levels} · ${slots}`;
}
