import { describe, expect, it } from "vitest";
import {
  assignmentToData,
  readAssignment as readStoredAssignment,
  studentWhereForAssignment,
  studentWhereForLecturer,
} from "./lecturer-assignment";
import {
  canAddCoTutor,
  fittingSeat,
  isAutoLinkable,
  planLink,
  seatsFor,
  summarizePlans,
  type LinkStudent,
} from "./tutor-class-match";

/**
 * Build an assignment the way the save path stores it: `assignmentToData` writes
 * the groups AND the flat branch/level/sitting mirrors, and `isAssigned` needs
 * the mirrors. A fixture with only `assignmentGroups` describes a tutor who
 * cannot exist in the database.
 */
function readAssignment(input: Parameters<typeof assignmentToData>[0]) {
  const groups = (Array.isArray(input.assignmentGroups) ? input.assignmentGroups : []) as Array<{
    branchId: string;
    level: string;
    sessionSlot: string;
  }>;
  return readStoredAssignment(
    assignmentToData({
      branchIds: groups.map((group) => group.branchId),
      levels: groups.map((group) => group.level),
      sessionSlots: groups.map((group) => group.sessionSlot),
      ...input,
    }),
  );
}

const LAGOS = "branch-lagos";
const ONLINE = "branch-online";

function student(overrides: Partial<LinkStudent> = {}): LinkStudent {
  return {
    id: "s1",
    branchId: LAGOS,
    level: "A1",
    sessionSlot: "morning",
    classType: "group",
    deliveryMode: "physical",
    hybridOnlineSlot: null,
    admission: { batch: "September" },
    tutorId: null,
    coTutorIds: [],
    ...overrides,
  };
}

describe("studentWhereForAssignment — group filter survives the class-type filter", () => {
  const withGroups = readAssignment({
    branchIds: [ONLINE],
    levels: ["A1"],
    sessionSlots: ["evening"],
    classTypes: ["online"],
    assignmentGroups: [{ branchId: ONLINE, level: "A1", sessionSlot: "evening" }],
  });

  it("keeps the teaching-group clauses when a class type is also chosen", () => {
    const where = studentWhereForAssignment(withGroups) as Record<string, unknown>;
    // Regression: the class-type clauses used to be assigned to `where.OR`,
    // replacing the groups, so every online student at every level matched.
    expect(where.OR).toEqual([{ branchId: ONLINE, level: "A1", sessionSlot: "evening" }]);
    expect(where.AND).toEqual([
      { OR: [{ classType: "group", deliveryMode: { in: ["online", "hybrid"] } }] },
    ]);
  });

  it("keeps the flat branch/level filter when a class type is chosen", () => {
    const flat = readAssignment({ branchIds: [LAGOS], levels: ["B1"], classTypes: ["physical"] });
    const where = studentWhereForAssignment(flat) as Record<string, unknown>;
    expect(where.branchId).toEqual({ in: [LAGOS] });
    expect(where.level).toEqual({ in: ["B1"] });
    expect(where.AND).toBeDefined();
  });

  it("leaves the named-student route as a sibling OR so it still outranks the class match", () => {
    const where = studentWhereForLecturer(withGroups, "lec-1") as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1]).toEqual({ OR: [{ tutorId: "lec-1" }, { coTutors: { some: { lecturerId: "lec-1" } } }] });
  });
});

describe("seatsFor", () => {
  it("gives a hybrid student a campus seat and an online seat", () => {
    const seats = seatsFor(student({ deliveryMode: "hybrid", hybridOnlineSlot: "evening" }), ONLINE);
    expect(seats.map((seat) => seat.seat)).toEqual(["campus", "online"]);
    expect(seats[1]).toMatchObject({ branchId: ONLINE, sessionSlot: "evening" });
  });

  it("drops the online seat of a hybrid student who has not picked an online sitting", () => {
    expect(seatsFor(student({ deliveryMode: "hybrid" }), ONLINE).map((seat) => seat.seat)).toEqual(["campus"]);
  });

  it("gives a private student one private seat", () => {
    expect(seatsFor(student({ classType: "private" }), ONLINE).map((seat) => seat.seat)).toEqual(["private"]);
  });
});

describe("fittingSeat — exact level, sitting, batch and branch", () => {
  const morningA1 = readAssignment({
    assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning", batch: "September" }],
  });

  it("fits the exact level + sitting + batch", () => {
    expect(fittingSeat(morningA1, student(), ONLINE)).toBe("campus");
  });

  it("does not fit another level", () => {
    expect(fittingSeat(morningA1, student({ level: "A2" }), ONLINE)).toBeNull();
  });

  it("does not fit another sitting", () => {
    expect(fittingSeat(morningA1, student({ sessionSlot: "evening" }), ONLINE)).toBeNull();
  });

  it("does not fit another intake month", () => {
    expect(fittingSeat(morningA1, student({ admission: { batch: "October" } }), ONLINE)).toBeNull();
  });

  it("does not fit another branch", () => {
    expect(fittingSeat(morningA1, student({ branchId: "branch-abuja" }), ONLINE)).toBeNull();
  });

  it("does not fit anybody when the tutor has no branch and level", () => {
    expect(fittingSeat(readAssignment({}), student(), ONLINE)).toBeNull();
  });

  it("an online tutor fits the ONLINE half of a hybrid student, not just their campus half", () => {
    const onlineEvening = readAssignment({
      classTypes: ["online"],
      assignmentGroups: [{ branchId: ONLINE, level: "A1", sessionSlot: "evening" }],
    });
    const hybrid = student({ deliveryMode: "hybrid", hybridOnlineSlot: "evening" });
    expect(fittingSeat(onlineEvening, hybrid, ONLINE)).toBe("online");
    // ...and a physical-only tutor is not a fit for a physical student at another branch.
    expect(fittingSeat(onlineEvening, student(), ONLINE)).toBeNull();
  });

  it("a physical-only tutor never fits an online student", () => {
    const campusOnly = readAssignment({
      classTypes: ["physical"],
      assignmentGroups: [{ branchId: ONLINE, level: "A1", sessionSlot: "morning" }],
    });
    expect(fittingSeat(campusOnly, student({ branchId: ONLINE, deliveryMode: "online" }), ONLINE)).toBeNull();
  });

  it("a private-only tutor fits private students and nobody else", () => {
    const privateOnly = readAssignment({
      classTypes: ["private"],
      assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
    });
    expect(fittingSeat(privateOnly, student({ classType: "private" }), ONLINE)).toBe("private");
    expect(fittingSeat(privateOnly, student(), ONLINE)).toBeNull();
  });
});

describe("planLink — how a fitting student is linked", () => {
  const lecturerId = "lec-new";
  const morningA1 = readAssignment({
    assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
  });
  const onlineEvening = readAssignment({
    classTypes: ["online"],
    assignmentGroups: [{ branchId: ONLINE, level: "A1", sessionSlot: "evening" }],
  });
  const plan = (assignment: ReturnType<typeof readAssignment>, s: LinkStudent, shared = true) =>
    planLink({ lecturerId, assignment, student: s, onlineBranchId: ONLINE, sharedStudentsEnabled: shared });

  it("a fitting student with no tutor becomes the primary", () => {
    expect(plan(morningA1, student()).action).toBe("add_primary");
  });

  it("a student who does not fit is left alone", () => {
    expect(plan(morningA1, student({ level: "B2" })).action).toBe("no_fit");
  });

  it("a student already on this tutor is 'linked', as primary or as co-tutor", () => {
    expect(plan(morningA1, student({ tutorId: lecturerId })).action).toBe("linked");
    expect(plan(morningA1, student({ tutorId: "other", coTutorIds: [lecturerId] })).action).toBe("linked");
  });

  it("an online student who already has a tutor gets this tutor as a co-tutor", () => {
    const s = student({ branchId: ONLINE, deliveryMode: "online", sessionSlot: "evening", tutorId: "other" });
    expect(plan(onlineEvening, s)).toMatchObject({ action: "add_co_tutor", role: null });
  });

  it("the online half of a hybrid student becomes a co-tutor tagged 'online' — even with no primary yet", () => {
    const withPrimary = student({ deliveryMode: "hybrid", hybridOnlineSlot: "evening", tutorId: "campus-tutor" });
    expect(plan(onlineEvening, withPrimary)).toMatchObject({ action: "add_co_tutor", role: "online", seat: "online" });
    const noPrimary = student({ deliveryMode: "hybrid", hybridOnlineSlot: "evening" });
    expect(plan(onlineEvening, noPrimary)).toMatchObject({ action: "add_co_tutor", role: "online" });
  });

  it("the campus half of a hybrid student with no tutor makes this tutor the primary (campus) tutor", () => {
    const hybrid = student({ deliveryMode: "hybrid", hybridOnlineSlot: "evening" });
    expect(plan(morningA1, hybrid)).toMatchObject({ action: "add_primary", seat: "campus" });
  });

  it("a physical student who already has a tutor is NOT silently taken over", () => {
    expect(plan(morningA1, student({ tutorId: "other" })).action).toBe("shares_class");
  });

  it("a private student who already has a tutor is a conflict, never auto-linked", () => {
    const privateOnly = readAssignment({
      classTypes: ["private"],
      assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
    });
    const result = plan(privateOnly, student({ classType: "private", tutorId: "other" }));
    expect(result.action).toBe("conflict");
    expect(isAutoLinkable(result.action)).toBe(false);
  });

  it("respects the multi-tutor switch: one extra tutor is allowed when it is off, a second is not", () => {
    const first = student({ branchId: ONLINE, deliveryMode: "online", sessionSlot: "evening", tutorId: "a" });
    expect(plan(onlineEvening, first, false).action).toBe("add_co_tutor");
    const second = { ...first, coTutorIds: ["b"] };
    expect(plan(onlineEvening, second, false).action).toBe("blocked");
    expect(plan(onlineEvening, second, true).action).toBe("add_co_tutor");
  });

  it("only the two automatic actions are auto-linkable", () => {
    expect(isAutoLinkable("add_primary")).toBe(true);
    expect(isAutoLinkable("add_co_tutor")).toBe(true);
    for (const action of ["linked", "shares_class", "conflict", "blocked", "no_fit"] as const) {
      expect(isAutoLinkable(action)).toBe(false);
    }
  });
});

describe("canAddCoTutor / summarizePlans", () => {
  it("allows the rescue valve only for a student with no extra tutor", () => {
    expect(canAddCoTutor(false, 0)).toBe(true);
    expect(canAddCoTutor(false, 1)).toBe(false);
    expect(canAddCoTutor(true, 5)).toBe(true);
  });

  it("counts plans by action", () => {
    const summary = summarizePlans([{ action: "add_primary" }, { action: "add_primary" }, { action: "conflict" }]);
    expect(summary.add_primary).toBe(2);
    expect(summary.conflict).toBe(1);
    expect(summary.no_fit).toBe(0);
  });
});
