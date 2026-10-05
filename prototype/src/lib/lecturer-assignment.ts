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
 * the browser. `live-classroom` and `levels` are both browser-safe for the
 * same reason.
 */

import { cohortRoomName } from "@/lib/live-classroom";
import { batchRangeLabel } from "@/lib/levels";
import { batchOfAdmission, batchTitle, canonicalBatch, compareBatches } from "@/lib/class-batch";

export const COURSE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const SESSION_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;

/**
 * How a class is delivered. Distinct from `Student.classType` (group/private),
 * which answers a different question — this one is about the room.
 */
export const CLASS_TYPES = ["physical", "online", "private"] as const;

/**
 * Named packages a tutor's coverage can be scoped to, on top of the ordinary
 * branch/level/session/classType/batch dimensions — so far just the one: an
 * "exam preparatory tutor" is a tutor whose `pathways` names it, and whose
 * roster (via `studentWhereForAssignment` below) then narrows to students on
 * that pathway the same way a classType restriction narrows to a delivery
 * mode. Matches `Student.pathway` (see EXAM_PREPARATORY_PATHWAY in
 * payment.ts) case-insensitively, same as every other list here.
 */
export const ASSIGNABLE_PATHWAYS = ["Exam Preparatory"] as const;

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
  /**
   * A level paired with its sitting, and optionally the one intake month that
   * pairing runs for. `batch` empty means "every intake" — the same as leaving
   * the standalone batch picker alone. It is what lets one tutor take the
   * September A1 afternoon class and the August B2 morning class without August
   * leaking onto the A1 group.
   */
  groups: Array<{ branchId: string; level: string; sessionSlot: string; batch?: string }>;
  classTypes: string[];
  batches: string[];
  /** Named packages this tutor covers — see ASSIGNABLE_PATHWAYS. Empty = no restriction, like every list above. */
  pathways: string[];
};

/** The shape this reads from — a Lecturer row, or a plain object in a form. */
export type AssignmentSource = {
  branchId?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  branchIds?: unknown;
  levels?: unknown;
  sessionSlots?: unknown;
  assignmentGroups?: unknown;
  classTypes?: unknown;
  batches?: unknown;
  pathways?: unknown;
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
    return { branchIds: [], levels: [], sessionSlots: [], groups: [], classTypes: [], batches: [], pathways: [] };
  }

  const branchIds = readList(source.branchIds);
  const levels = readList(source.levels, COURSE_LEVELS);
  const sessionSlots = readList(source.sessionSlots, SESSION_SLOTS);
  const groups = Array.isArray(source.assignmentGroups)
    ? source.assignmentGroups.flatMap((group) => {
        if (!group || typeof group !== "object") return [];
        const value = group as Record<string, unknown>;
        const branchId = typeof value.branchId === "string" ? value.branchId.trim() : "";
        const level = readList([value.level], COURSE_LEVELS)[0];
        const sessionSlot = readList([value.sessionSlot], SESSION_SLOTS)[0];
        const batch = readList([value.batch], BATCHES)[0];
        return branchId && level && sessionSlot
          ? [batch ? { branchId, level, sessionSlot, batch } : { branchId, level, sessionSlot }]
          : [];
      })
    : [];

  return {
    branchIds: branchIds.length ? branchIds : source.branchId ? [source.branchId] : [],
    levels: levels.length ? levels : source.level ? readList([source.level], COURSE_LEVELS) : [],
    sessionSlots: sessionSlots.length
      ? sessionSlots
      : source.sessionSlot
        ? readList([source.sessionSlot], SESSION_SLOTS)
        : [],
      groups,
    classTypes: readList(source.classTypes, CLASS_TYPES),
    batches: readList(source.batches, BATCHES),
    pathways: readList(source.pathways, ASSIGNABLE_PATHWAYS),
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

  const where: Record<string, unknown> = assignment.groups.length
    ? { OR: assignment.groups.map((group) => ({ branchId: group.branchId, level: group.level, sessionSlot: group.sessionSlot })) }
    : { branchId: { in: assignment.branchIds }, level: { in: assignment.levels } };

  if (!assignment.groups.length && assignment.sessionSlots.length) {
    where.sessionSlot = { in: assignment.sessionSlots };
  }

  // "physical" and "online" describe how a class is delivered and map onto the
  // student's deliveryMode; "private" maps onto their classType. A tutor who
  // takes private students only should not see the group cohort, and vice
  // versa. Selecting all three (or none) restricts nothing.
  //
  // COMBINED WITH `AND`, NEVER BY ASSIGNING `where.OR`. When the tutor has
  // teaching groups, `where.OR` already holds the group clauses; assigning the
  // class-type clauses to the same key threw the groups away, so a tutor set to
  // "Online / hybrid" matched every online student at every level and branch —
  // the "it selected all 454 students" bug.
  const types = assignment.classTypes.map((type) => type.toLowerCase());
  const andClauses: Array<Record<string, unknown>> = [];
  if (types.length && types.length < CLASS_TYPES.length) {
    const clauses: Array<Record<string, unknown>> = [];
    if (types.includes("physical")) clauses.push({ classType: "group", deliveryMode: { in: ["physical", "hybrid"] } });
    if (types.includes("online")) clauses.push({ classType: "group", deliveryMode: { in: ["online", "hybrid"] } });
    if (types.includes("private")) clauses.push({ classType: "private" });
    if (clauses.length) andClauses.push({ OR: clauses });
  }

  // A tutor scoped to a named package (see ASSIGNABLE_PATHWAYS) only teaches
  // students on it — combined with `AND`, same reasoning as classTypes above:
  // assigning straight to `where.OR` would throw away the group clauses.
  if (assignment.pathways.length) {
    andClauses.push({ pathway: { in: assignment.pathways } });
  }

  if (andClauses.length) where.AND = andClauses;

  return where;
}

/**
 * Turn an assignment into the Prisma `where` that finds the community rooms it
 * covers. A `Space` only carries branch + level + session, so this is a
 * narrower cousin of `studentWhereForAssignment` — no classType clause,
 * because a room is not one of those things. Same "empty list = no
 * restriction, empty branch/level = unassigned" rule, for the same reason: a
 * tutor left with no sitting chosen still only teaches Lagos A1, all sittings.
 *
 * A room is one BATCH of one sitting, so a tutor the office pinned to the
 * September batch sees September's room and not October's. A tutor with no
 * batch pinned teaches every intake of the cohort and sees all of its rooms.
 */
export function spaceWhereForAssignment(assignment: LecturerAssignment): Record<string, unknown> | null {
  if (!isAssigned(assignment)) return null;

  const where: Record<string, unknown> = assignment.groups.length
    ? {
        OR: assignment.groups.map((group) => ({
          branchId: group.branchId,
          level: group.level,
          sessionSlot: group.sessionSlot,
          ...(canonicalBatch(group.batch) ? { batch: canonicalBatch(group.batch) } : {}),
        })),
      }
    : { branchId: { in: assignment.branchIds }, level: { in: assignment.levels } };

  if (!assignment.groups.length && assignment.sessionSlots.length) {
    where.sessionSlot = { in: assignment.sessionSlots };
  }

  if (!assignment.groups.length) {
    const months = assignment.batches.map((batch) => canonicalBatch(batch)).filter(Boolean);
    if (months.length) where.batch = { in: months };
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
 * `StudentCoTutor` is the THIRD route, and reads exactly like the second: an
 * online or hybrid student shared onto this tutor as an extra teacher (see
 * src/lib/tutor-pairing.ts) is on their roster for every purpose the primary
 * pairing is — register, gradebook, live class.
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
  const named = lecturerId
    ? { OR: [{ tutorId: lecturerId }, { coTutors: { some: { lecturerId } } }] }
    : null;

  if (cohort && named) return { OR: [cohort, named] };
  return cohort ?? named;
}

/**
 * Narrow the tutor's roster further to a single level and sitting when the UI or
 * assignment screen asks for it.
 *
 * This is intentionally stricter than the broad assignment view: a tutor can see
 * the whole cohort in their dashboard, but an assignment picker must only offer
 * the students for the exact level/session they are creating for. A tutor who
 * teaches morning and afternoon A1 classes must never see an afternoon student
 * when they pick the morning-only filter.
 */
export function studentWhereForLecturerScope(
  assignment: LecturerAssignment,
  lecturerId?: string | null,
  options?: { level?: string | null; sessionSlot?: string | null; branchId?: string | null },
): Record<string, unknown> | null {
  const level = options?.level ? String(options.level).trim().toUpperCase() : null;
  const sessionSlot = options?.sessionSlot ? String(options.sessionSlot).trim().toLowerCase() : null;
  const branchId = options?.branchId ? String(options.branchId) : null;

  // The level / sitting / branch narrowing that applies to a named student,
  // whichever route named them.
  const namedFilters: Record<string, unknown> = {};
  if (level) namedFilters.level = level;
  if (sessionSlot) namedFilters.sessionSlot = sessionSlot;
  if (branchId) namedFilters.branchId = branchId;

  // A student is "named" onto this tutor if they are the primary tutor OR a
  // co-tutor — the same two routes as studentWhereForLecturer, each carrying
  // the narrowing above.
  const namedClauses: Record<string, unknown>[] = lecturerId
    ? [
        { ...namedFilters, tutorId: lecturerId },
        { ...namedFilters, coTutors: { some: { lecturerId } } },
      ]
    : Object.keys(namedFilters).length
      ? [namedFilters]
      : [];

  const cohortWhere = studentWhereForAssignment(assignment);
  if (!cohortWhere) {
    if (!namedClauses.length) return null;
    return namedClauses.length === 1 ? namedClauses[0] : { OR: namedClauses };
  }

  const narrowed: Record<string, unknown> = { ...cohortWhere };

  if (level) {
    if (Array.isArray((cohortWhere as { OR?: unknown[] }).OR)) {
      narrowed.OR = (cohortWhere as { OR: Record<string, unknown>[] }).OR.map((clause) => ({
        ...(clause as Record<string, unknown>),
        level,
        ...(branchId ? { branchId } : {}),
        ...(sessionSlot ? { sessionSlot } : {}),
      }));
    } else {
      narrowed.level = level;
      if (branchId) narrowed.branchId = branchId;
      if (sessionSlot) narrowed.sessionSlot = sessionSlot;
    }
  }

  if (!level && sessionSlot) {
    if (Array.isArray((cohortWhere as { OR?: unknown[] }).OR)) {
      narrowed.OR = (cohortWhere as { OR: Record<string, unknown>[] }).OR.map((clause) => ({
        ...(clause as Record<string, unknown>),
        ...(branchId ? { branchId } : {}),
        sessionSlot,
      }));
    } else {
      narrowed.sessionSlot = sessionSlot;
      if (branchId) narrowed.branchId = branchId;
    }
  }

  if (!level && !sessionSlot && branchId) {
    if (Array.isArray((cohortWhere as { OR?: unknown[] }).OR)) {
      narrowed.OR = (cohortWhere as { OR: Record<string, unknown>[] }).OR.map((clause) => ({
        ...(clause as Record<string, unknown>),
        branchId,
      }));
    } else {
      narrowed.branchId = branchId;
    }
  }

  if (namedClauses.length) {
    return { OR: [narrowed, ...namedClauses] };
  }

  return narrowed;
}

/** The student's intake month, lower-cased, or "" when they have none. */
function admissionBatch(admission: unknown): string {
  const record = admission && typeof admission === "object" ? (admission as Record<string, unknown>) : {};
  return typeof record.batch === "string" ? record.batch.toLowerCase() : "";
}

/**
 * Every intake month this tutor is restricted to, from the standalone picker
 * AND from any per-group batch — a flat union for the callers that only need
 * "does this month concern this tutor at all?" (materials targeting, the coarse
 * `matchesBatch`). The precise "which group, which month" question is answered
 * in `belongsToLecturer`.
 */
export function assignmentBatches(assignment: LecturerAssignment): string[] {
  const groupBatches = (assignment.groups ?? [])
    .map((group) => group.batch)
    .filter((batch): batch is string => Boolean(batch));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const batch of [...(assignment.batches ?? []), ...groupBatches]) {
    const key = batch.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(batch);
  }
  return out;
}

/** Does anything at all narrow this tutor to specific intakes? */
export function hasBatchConstraint(assignment: LecturerAssignment): boolean {
  return assignment.batches.length > 0 || assignment.groups.some((group) => Boolean(group.batch));
}

/**
 * The in-memory half of the same question, applied after the rows come back.
 *
 * Batch cannot be filtered in SQL (it lives in the admission JSON), so it runs
 * here — and a named student must skip that filter too, for the same reason
 * they skip the branch one. Callers must select `tutorId` for this to work;
 * without it every named student silently falls through to the batch check.
 *
 * PER-GROUP BATCH. When any teaching group pins an intake month, this stops
 * being a flat "is the student in one of the tutor's months?" and becomes
 * "does the student match a group whose month they are in?" — so a September
 * pin on the A1 afternoon group does not pull in an August A1 afternoon
 * student, even though the tutor's other group runs in August. This needs the
 * row's branch / level / sitting; a caller that did not select them falls back
 * to the flat union check below, which is no stricter than before.
 */
export function belongsToLecturer(
  assignment: LecturerAssignment,
  lecturerId: string | null | undefined,
  student: {
    tutorId?: string | null;
    /** Extra tutors on this student (`Student.coTutors`) — a co-tutor is on the
     *  roster for every purpose the primary is. Pass either the raw relation
     *  (`coTutors: { select: { lecturerId: true } }`) or a flat id list;
     *  callers must select one of them for a shared student to survive the
     *  in-memory batch check below. */
    coTutors?: { lecturerId: string }[] | null;
    coTutorIds?: string[] | null;
    admission?: unknown;
    branchId?: string | null;
    level?: string | null;
    sessionSlot?: string | null;
  },
): boolean {
  if (lecturerId && student.tutorId && student.tutorId === lecturerId) return true;
  if (
    lecturerId &&
    (student.coTutorIds?.includes(lecturerId) ||
      student.coTutors?.some((link) => link.lecturerId === lecturerId))
  ) {
    return true;
  }

  const pinnedGroups = assignment.groups.filter((group) => Boolean(group.batch));
  const hasGroupKeys = student.level != null && student.sessionSlot != null;
  if (pinnedGroups.length && hasGroupKeys) {
    const studentBatch = admissionBatch(student.admission);
    const eq = (a: string | null | undefined, b: string | null | undefined) =>
      (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
    return assignment.groups.some(
      (group) =>
        eq(group.branchId, student.branchId) &&
        eq(group.level, student.level) &&
        eq(group.sessionSlot, student.sessionSlot) &&
        (!group.batch || group.batch.toLowerCase() === studentBatch),
    );
  }

  return matchesBatch(assignment, student.admission);
}

export type MatchClassType = "physical" | "online";

/** A seat a student occupies: one side of a hybrid combo, or the whole of a physical / online / private student. */
export type SeatClassType = MatchClassType | "private";

/** Does this tutor's coverage reach this delivery mode? Empty, or every class type selected, both mean "no restriction". */
export function coversClassType(assignment: LecturerAssignment, classType: SeatClassType): boolean {
  const types = assignment.classTypes.map((type) => type.toLowerCase());
  return !types.length || types.length >= CLASS_TYPES.length || types.includes(classType);
}

export type AssignmentAttemptStudent = {
  branchId: string | null;
  level: string;
  sessionSlot: string;
  admission?: unknown;
};

/**
 * Does this tutor's coverage match one concrete sitting — one side of a
 * hybrid combo, or the whole of a physical/online-only student? Used both by
 * the write-time auto-assign engine (lib/tutor-auto-assign.ts) and, for
 * suggesting a co-tutor, the admin student dossier — hence living here
 * rather than in the (server-only) auto-assign module.
 *
 * Branch/level/session are checked here directly — `belongsToLecturer` only
 * covers the in-memory batch/named-tutor half of the question, on the
 * assumption a SQL `where` already did this part.
 */
export function assignmentMatchesStudent(
  assignment: LecturerAssignment,
  classType: SeatClassType,
  student: AssignmentAttemptStudent,
): boolean {
  if (!isAssigned(assignment)) return false;

  const level = student.level.toUpperCase();
  const sessionSlot = student.sessionSlot.toLowerCase();

  const branchLevelSessionOk = assignment.groups.length
    ? assignment.groups.some(
        (group) =>
          group.branchId === student.branchId &&
          group.level.toUpperCase() === level &&
          group.sessionSlot.toLowerCase() === sessionSlot,
      )
    : Boolean(student.branchId) &&
      assignment.branchIds.includes(student.branchId as string) &&
      assignment.levels.some((candidate) => candidate.toUpperCase() === level) &&
      (!assignment.sessionSlots.length ||
        assignment.sessionSlots.some((candidate) => candidate.toLowerCase() === sessionSlot));

  if (!branchLevelSessionOk) return false;
  if (!coversClassType(assignment, classType)) return false;

  return belongsToLecturer(assignment, null, {
    admission: student.admission,
    branchId: student.branchId,
    level: student.level,
    sessionSlot: student.sessionSlot,
  });
}

/**
 * Batch lives in the admission JSON, so it is filtered in memory. Coarse: any
 * of the tutor's months (standalone picker or per-group) is a match. Use
 * `belongsToLecturer` where the group a student sits in matters.
 */
export function matchesBatch(assignment: LecturerAssignment, admission: unknown): boolean {
  const months = assignmentBatches(assignment);
  if (!months.length) return true;
  const batch = admissionBatch(admission);
  if (!batch) return false;
  return months.some((option) => option.toLowerCase() === batch);
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
  assignmentGroups?: unknown;
  classTypes?: unknown;
  batches?: unknown;
  pathways?: unknown;
}) {
  const branchIds = readList(input.branchIds);
  const levels = readList(input.levels, COURSE_LEVELS);
  const sessionSlots = readList(input.sessionSlots, SESSION_SLOTS);
  const assignmentGroups = Array.isArray(input.assignmentGroups)
    ? input.assignmentGroups.flatMap((group) => {
        if (!group || typeof group !== "object") return [];
        const value = group as Record<string, unknown>;
        const branchId = typeof value.branchId === "string" ? value.branchId.trim() : "";
        const level = readList([value.level], COURSE_LEVELS)[0];
        const sessionSlot = readList([value.sessionSlot], SESSION_SLOTS)[0];
        const batch = readList([value.batch], BATCHES)[0];
        return branchId && level && sessionSlot
          ? [batch ? { branchId, level, sessionSlot, batch } : { branchId, level, sessionSlot }]
          : [];
      })
    : [];
  const classTypes = readList(input.classTypes, CLASS_TYPES);
  const batches = readList(input.batches, BATCHES);
  const pathways = readList(input.pathways, ASSIGNABLE_PATHWAYS);

  return {
    branchIds,
    levels,
    sessionSlots,
    assignmentGroups,
    classTypes,
    batches,
    pathways,
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
  const pathway = assignment.pathways.length ? ` · ${assignment.pathways.join(", ")}` : "";

  return `${branches} · ${levels} · ${slots}${pathway}`;
}

/**
 * One class a tutor runs, as a self-contained thing the portal can point at.
 *
 * A tutor taking A1 morning AND B1 evening has two of these, and the whole
 * reason this type exists is that every downstream surface — the "my classes"
 * cards, the timetable's class picker, the "go live" button — was collapsing
 * them into one via the legacy primary `branchId`/`level`/`sessionSlot`
 * columns, which only ever mirror the FIRST group. Each group here carries its
 * own live room (the exact string its students derive), so opening it rings
 * the right cohort and nobody else.
 */
export type TeachingGroup = {
  /**
   * `branchId:LEVEL:slot:Batch` — safe in a URL and a segmented-control value.
   * The batch segment is left off for a group that is not tied to one intake
   * (`branchId:LEVEL:slot`), which is also every key that was ever bookmarked.
   */
  key: string;
  branchId: string;
  branchName: string;
  /** Upper-case, matching how `Student.level` and the room slug are built. */
  level: string;
  /** Lower-case sitting, or "" when the tutor takes every sitting of the level. */
  sessionSlot: string;
  /** The intake this class is — "September" — or null for a class not tied to one. */
  batch: string | null;
  /** This tutor's live room for the class (the batch and the tutor are part of the name). */
  roomName: string;
  /**
   * What the tutor reads on every screen that names a class: "A1 · Morning ·
   * September batch", or "B1 · Evening" for a group not tied to one intake.
   */
  label: string;
  /** "September – October" — "" when the group has no batch. */
  batchRange: string;
};

/** The columns of a student that decide which of a tutor's classes they sit in. */
export type GroupRosterStudent = {
  branchId?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  admission?: unknown;
};

type GroupRow = { branchId: string; level: string; sessionSlot: string; batch: string | null };

function buildTeachingGroup(
  row: GroupRow,
  branchNames: Map<string, string>,
  lecturerId?: string | null,
): TeachingGroup {
  const batch = canonicalBatch(row.batch) || null;
  const branchName = branchNames.get(row.branchId) ?? "Your branch";
  const slotLabel = row.sessionSlot
    ? row.sessionSlot.charAt(0).toUpperCase() + row.sessionSlot.slice(1)
    : "";
  const base = `${row.branchId}:${row.level}:${row.sessionSlot}`;
  const label = [row.level, slotLabel, batch ? batchTitle(batch) : ""].filter(Boolean).join(" · ");

  return {
    key: batch ? `${base}:${batch}` : base,
    branchId: row.branchId,
    branchName,
    level: row.level,
    sessionSlot: row.sessionSlot,
    batch,
    roomName: cohortRoomName({
      branchName,
      level: row.level,
      sessionSlot: row.sessionSlot || undefined,
      batch,
      lecturerId,
    }),
    label,
    batchRange: batchRangeLabel(batch, row.sessionSlot),
  };
}

/** Does this student sit in the cohort (branch + level + sitting) a group row describes? */
function studentInGroupCohort(row: GroupRow, student: GroupRosterStudent): boolean {
  return (
    student.branchId === row.branchId &&
    (student.level ?? "").toUpperCase() === row.level &&
    (!row.sessionSlot || (student.sessionSlot ?? "").toLowerCase() === row.sessionSlot)
  );
}

/**
 * Every distinct class this tutor runs.
 *
 * Prefers the admin's explicit teaching groups. Falls back to the cartesian
 * product of the flat branch / level / sitting lists — which, for a tutor
 * created before groups existed (one branch, one level, one sitting), is
 * exactly one entry that behaves as it always did. An all-sittings group
 * (`sessionSlots` empty) collapses to a single slot-less entry rather than
 * exploding into four.
 */
export function teachingGroups(
  assignment: LecturerAssignment,
  branchNames: Map<string, string>,
  /**
   * The tutor these groups belong to. It goes into each group's live room so
   * two tutors on the same branch + level + sitting never share one — see
   * `cohortRoomName`. Every caller that hands a room to a tutor's page must
   * pass it, or the room it shows will not be the room the session opens.
   */
  lecturerId?: string | null,
  /**
   * The tutor's students. THIS is what splits a class by batch.
   *
   * A tutor who takes "Lagos A1 morning, every intake" usually has September
   * AND October students in it — two batches that overlap for a month and run
   * on different timetables. Without the roster they were one card, one live
   * room and one chat, and "go live" reached both. With it, every batch the
   * tutor really has students in becomes its own class: its own label ("A1 ·
   * Morning · October batch"), its own Go-live, its own room.
   *
   * Only groups NOT already pinned to a month are split — a pinned group is the
   * office having said which batch it is. A cohort with no students, or whose
   * students have no batch on record, stays as one class so a tutor can still
   * open it.
   */
  roster?: GroupRosterStudent[] | null,
): TeachingGroup[] {
  if (!isAssigned(assignment)) return [];

  const baseRows: GroupRow[] = assignment.groups.length
    ? assignment.groups.map((group) => ({
        branchId: group.branchId,
        level: group.level.toUpperCase(),
        sessionSlot: group.sessionSlot.toLowerCase(),
        batch: group.batch ?? null,
      }))
    : assignment.branchIds.flatMap((branchId) =>
        assignment.levels.flatMap((level) =>
          (assignment.sessionSlots.length ? assignment.sessionSlots : [""]).flatMap((sessionSlot): GroupRow[] => {
            const row = {
              branchId,
              level: level.toUpperCase(),
              sessionSlot: sessionSlot.toLowerCase(),
            };
            // A flat-list tutor restricted to intake months teaches each of them
            // as its own class. (This used to keep only the first.)
            return assignment.batches.length
              ? assignment.batches.map((batch) => ({ ...row, batch }))
              : [{ ...row, batch: null }];
          }),
        ),
      );

  // Split every group that is not pinned to a month by the batches it really has.
  const rows = baseRows.flatMap((row): GroupRow[] => {
    if (row.batch || !roster?.length) return [row];
    const found = new Set<string>();
    for (const student of roster) {
      if (!studentInGroupCohort(row, student)) continue;
      const batch = batchOfAdmission(student.admission);
      if (batch) found.add(batch);
    }
    if (found.size === 0) return [row];
    return [...found].sort((a, b) => compareBatches(a, b)).map((batch) => ({ ...row, batch }));
  });

  const seen = new Set<string>();
  const out: TeachingGroup[] = [];
  for (const row of rows) {
    const group = buildTeachingGroup(row, branchNames, lecturerId);
    if (seen.has(group.key)) continue;
    seen.add(group.key);
    out.push(group);
  }
  return out;
}

/**
 * The students of one class — same branch, level, sitting AND batch. The one
 * definition every tutor screen counts a class's students with, so the card, the
 * roster and the register can never disagree about who is in it.
 *
 * A class with no batch takes the whole cohort. A batch class takes only that
 * batch's students: someone with no batch on record belongs to no batch class,
 * and is shown separately as "not placed in a batch yet".
 */
export function studentsInGroup<T extends GroupRosterStudent>(
  group: Pick<TeachingGroup, "branchId" | "level" | "sessionSlot" | "batch">,
  students: T[],
): T[] {
  const want = canonicalBatch(group.batch);
  return students.filter(
    (student) =>
      studentInGroupCohort(
        { branchId: group.branchId, level: group.level.toUpperCase(), sessionSlot: group.sessionSlot.toLowerCase(), batch: null },
        student,
      ) &&
      (!want || batchOfAdmission(student.admission) === want),
  );
}

/**
 * Split a `branchId:LEVEL:slot[:Batch]` key back into its parts. Returns null
 * for anything that is not three or four segments, or whose fourth is not a
 * month — a caller handed a bad key should fall back to the tutor's primary
 * class, not 500. `batch` is "" when the key names no batch (every key that was
 * bookmarked before classes split by batch).
 */
export function parseGroupKey(
  key: string | null | undefined,
): { branchId: string; level: string; sessionSlot: string; batch: string } | null {
  const parts = String(key ?? "").split(":");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [branchId, level, sessionSlot] = parts;
  if (!branchId || !level) return null;
  const batch = parts.length === 4 ? canonicalBatch(parts[3]) : "";
  if (parts.length === 4 && !batch) return null;
  return { branchId, level: level.toUpperCase(), sessionSlot: sessionSlot.toLowerCase(), batch };
}

/**
 * Does this tutor's assignment actually contain the given group? The gate for
 * "go live with THIS class" — a key in a query string is a request, not a
 * grant, and a tutor must not be able to open a room for a cohort the office
 * never put them on.
 *
 * The batch is checked against the assignment too, without needing the roster:
 * a group the office pinned to September can only be opened as September, while
 * an every-intake group can be opened as any month (the tutor's classes list
 * only offers the months they really have students in, and that is a
 * convenience, not a gate — the room is theirs either way).
 */
export function assignmentHasGroup(
  assignment: LecturerAssignment,
  branchNames: Map<string, string>,
  target: { branchId: string; level: string; sessionSlot: string; batch?: string | null },
  lecturerId?: string | null,
): TeachingGroup | null {
  const cohort = `${target.branchId}:${target.level.toUpperCase()}:${target.sessionSlot.toLowerCase()}`;
  const candidates = teachingGroups(assignment, branchNames, lecturerId).filter(
    (group) => `${group.branchId}:${group.level}:${group.sessionSlot}` === cohort,
  );
  if (candidates.length === 0) return null;

  const wanted = canonicalBatch(target.batch);
  if (!wanted) return candidates.find((group) => !group.batch) ?? candidates[0];

  const pinned = candidates.find((group) => group.batch === wanted);
  if (pinned) return pinned;

  const everyIntake = candidates.find((group) => !group.batch);
  if (!everyIntake) return null;
  return buildTeachingGroup(
    {
      branchId: everyIntake.branchId,
      level: everyIntake.level,
      sessionSlot: everyIntake.sessionSlot,
      batch: wanted,
    },
    branchNames,
    lecturerId,
  );
}
