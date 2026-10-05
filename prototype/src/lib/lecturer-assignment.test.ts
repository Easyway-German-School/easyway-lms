import { describe, expect, it } from "vitest";
import {
  assignmentBatches,
  assignmentHasGroup,
  belongsToLecturer,
  hasBatchConstraint,
  matchesBatch,
  parseGroupKey,
  readAssignment,
  spaceWhereForAssignment,
  studentsInGroup,
  studentWhereForAssignment,
  studentWhereForLecturerScope,
  teachingGroups,
} from "./lecturer-assignment";
import { batchMonthSpan, batchRangeLabel } from "./levels";

describe("pathways — the exam preparatory tutor dimension", () => {
  it("readAssignment defaults to no restriction, same as every other tutor", () => {
    const assignment = readAssignment({ branchIds: ["branch-a"], levels: ["A1"] });
    expect(assignment.pathways).toEqual([]);
  });

  it("readAssignment keeps only recognised pathways, canonicalised case-insensitively", () => {
    const assignment = readAssignment({
      branchIds: ["branch-a"],
      levels: ["A1"],
      pathways: ["exam preparatory", "Not A Real Package"],
    });
    expect(assignment.pathways).toEqual(["Exam Preparatory"]);
  });

  it("an empty pathways list narrows nothing — studentWhereForAssignment matches every existing tutor's query", () => {
    const assignment = readAssignment({ branchIds: ["branch-a"], levels: ["A1"] });
    const where = studentWhereForAssignment(assignment);
    expect(where).not.toHaveProperty("AND");
  });

  it("a pathway-scoped tutor's query is narrowed by an AND clause, not by overwriting the branch/level match", () => {
    const assignment = readAssignment({
      branchIds: ["branch-a"],
      levels: ["A1"],
      pathways: ["Exam Preparatory"],
    });
    const where = studentWhereForAssignment(assignment);
    expect(where).toMatchObject({
      branchId: { in: ["branch-a"] },
      level: { in: ["A1"] },
      AND: [{ pathway: { in: ["Exam Preparatory"] } }],
    });
  });

  it("combines with a classType restriction without either clause overwriting the other", () => {
    // Regression guard for the same class of bug the classTypes comment in
    // lecturer-assignment.ts describes ("it selected all 454 students"): two
    // independent AND-worthy restrictions must both survive, not stomp on
    // where.AND in turn.
    const assignment = readAssignment({
      branchIds: ["branch-a"],
      levels: ["A1"],
      classTypes: ["private"],
      pathways: ["Exam Preparatory"],
    });
    const where = studentWhereForAssignment(assignment) as { AND: unknown[] };
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({ OR: [{ classType: "private" }] });
    expect(where.AND).toContainEqual({ pathway: { in: ["Exam Preparatory"] } });
  });
});

describe("studentWhereForLecturerScope", () => {
  it("narrows the tutor cohort to the selected session when the admin assignment is broader", () => {
    const assignment = readAssignment({
      branchIds: ["branch-a"],
      levels: ["A1"],
      sessionSlots: ["morning", "afternoon"],
    });

    const where = studentWhereForLecturerScope(assignment, "lecturer-1", {
      level: "A1",
      sessionSlot: "afternoon",
    });

    expect(where).toMatchObject({
      OR: [
        {
          branchId: { in: ["branch-a"] },
          level: "A1",
          sessionSlot: "afternoon",
        },
        { tutorId: "lecturer-1", level: "A1", sessionSlot: "afternoon" },
        // Co-tutors reach the student the same way the primary does, and carry
        // the same level/sitting narrowing — see studentWhereForLecturer.
        {
          coTutors: { some: { lecturerId: "lecturer-1" } },
          level: "A1",
          sessionSlot: "afternoon",
        },
      ],
    });
  });

  it("includes a co-tutored student even when their cohort fields do not match", () => {
    const assignment = readAssignment({ branchIds: ["branch-a"], levels: ["A1"] });
    const where = studentWhereForLecturerScope(assignment, "lecturer-1");
    expect(where).toMatchObject({
      OR: [
        { branchId: { in: ["branch-a"] }, level: { in: ["A1"] } },
        { tutorId: "lecturer-1" },
        { coTutors: { some: { lecturerId: "lecturer-1" } } },
      ],
    });
  });
});

describe("belongsToLecturer with co-tutors", () => {
  // Two pinned groups, so the in-memory batch check actually excludes rows —
  // the same fixture the per-group-batch tests use.
  const twoGroups = readAssignment({
    branchIds: ["b1"],
    levels: ["A1", "B2"],
    sessionSlots: ["afternoon", "morning"],
    assignmentGroups: [
      { branchId: "b1", level: "A1", sessionSlot: "afternoon", batch: "September" },
      { branchId: "b1", level: "B2", sessionSlot: "morning", batch: "August" },
    ],
  });

  it("a co-tutored student is IN even when their intake month does not match", () => {
    const wrongMonthButCoTutor = {
      coTutors: [{ lecturerId: "lec-1" }],
      admission: { batch: "January" },
    };
    expect(belongsToLecturer(twoGroups, "lec-1", wrongMonthButCoTutor)).toBe(true);
    expect(
      belongsToLecturer(twoGroups, "lec-1", { coTutorIds: ["lec-2", "lec-1"], admission: { batch: "January" } }),
    ).toBe(true);
  });

  it("a row co-tutored by someone else still falls to the ordinary batch check", () => {
    expect(
      belongsToLecturer(twoGroups, "lec-1", {
        coTutors: [{ lecturerId: "lec-9" }],
        admission: { batch: "January" },
      }),
    ).toBe(false);
  });
});

describe("per-group batch", () => {
  const twoGroups = readAssignment({
    branchIds: ["b1"],
    levels: ["A1", "B2"],
    sessionSlots: ["afternoon", "morning"],
    assignmentGroups: [
      { branchId: "b1", level: "A1", sessionSlot: "afternoon", batch: "September" },
      { branchId: "b1", level: "B2", sessionSlot: "morning", batch: "August" },
    ],
  });

  it("reads the batch onto each teaching group", () => {
    expect(twoGroups.groups).toEqual([
      { branchId: "b1", level: "A1", sessionSlot: "afternoon", batch: "September" },
      { branchId: "b1", level: "B2", sessionSlot: "morning", batch: "August" },
    ]);
  });

  it("drops an out-of-vocabulary batch but keeps the group", () => {
    const parsed = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "Smarch" }],
    });
    expect(parsed.groups).toEqual([{ branchId: "b1", level: "A1", sessionSlot: "morning" }]);
  });

  it("unions the standalone and per-group months for coarse consumers", () => {
    expect(assignmentBatches(twoGroups).sort()).toEqual(["August", "September"]);
    expect(hasBatchConstraint(twoGroups)).toBe(true);
    const noBatch = readAssignment({ branchIds: ["b1"], levels: ["A1"] });
    expect(hasBatchConstraint(noBatch)).toBe(false);
  });

  it("keeps a student only in the group whose month they are in", () => {
    const sepA1 = { branchId: "b1", level: "A1", sessionSlot: "afternoon", admission: { batch: "September" } };
    const augA1 = { branchId: "b1", level: "A1", sessionSlot: "afternoon", admission: { batch: "August" } };
    const augB2 = { branchId: "b1", level: "B2", sessionSlot: "morning", admission: { batch: "August" } };

    expect(belongsToLecturer(twoGroups, "lec-1", sepA1)).toBe(true);
    // August must not leak onto the September A1 group.
    expect(belongsToLecturer(twoGroups, "lec-1", augA1)).toBe(false);
    expect(belongsToLecturer(twoGroups, "lec-1", augB2)).toBe(true);
  });

  it("still lets a named student through regardless of month", () => {
    const wrongMonthButNamed = {
      tutorId: "lec-1",
      branchId: "b1",
      level: "A1",
      sessionSlot: "afternoon",
      admission: { batch: "August" },
    };
    expect(belongsToLecturer(twoGroups, "lec-1", wrongMonthButNamed)).toBe(true);
  });

  it("falls back to the flat union when the row lacks group keys", () => {
    // No branch/level/sessionSlot selected → coarse check, September is allowed.
    expect(belongsToLecturer(twoGroups, "lec-1", { admission: { batch: "September" } })).toBe(true);
    expect(belongsToLecturer(twoGroups, "lec-1", { admission: { batch: "January" } })).toBe(false);
  });

  it("an unpinned group matches every month", () => {
    const mixed = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning" }],
    });
    const student = { branchId: "b1", level: "A1", sessionSlot: "morning", admission: { batch: "July" } };
    expect(belongsToLecturer(mixed, "lec-1", student)).toBe(true);
    expect(matchesBatch(mixed, student.admission)).toBe(true);
  });
});


describe("teachingGroups", () => {
  const names = new Map([
    ["b1", "Lagos"],
    ["b2", "Abuja"],
  ]);

  it("splits an explicit multi-group assignment into one entry per class", () => {
    const assignment = readAssignment({
      branchIds: ["b1"],
      levels: ["A1", "B1"],
      sessionSlots: ["morning", "evening"],
      assignmentGroups: [
        { branchId: "b1", level: "A1", sessionSlot: "morning", batch: "August" },
        { branchId: "b1", level: "B1", sessionSlot: "evening", batch: "September" },
      ],
    });

    const groups = teachingGroups(assignment, names);
    expect(groups.map((group) => group.key)).toEqual(["b1:A1:morning:August", "b1:B1:evening:September"]);
    expect(groups[0]).toMatchObject({
      branchName: "Lagos",
      label: "A1 · Morning · August batch",
      batch: "August",
      batchRange: "August – September",
      roomName: "ew-lagos-a1-morning-b-august",
    });
    expect(groups[1].batchRange).toBe("September – October");
    expect(groups[1].roomName).toBe("ew-lagos-b1-evening-b-september");
  });

  it("falls back to the flat lists for a legacy single-class tutor", () => {
    const assignment = readAssignment({ branchId: "b2", level: "A2", sessionSlot: "afternoon" });
    const groups = teachingGroups(assignment, names);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "b2:A2:afternoon", label: "A2 · Afternoon", batchRange: "" });
  });

  it("collapses an all-sittings assignment to one slot-less entry", () => {
    const assignment = readAssignment({ branchIds: ["b1"], levels: ["A1"] });
    const groups = teachingGroups(assignment, names);
    expect(groups).toEqual([
      expect.objectContaining({ key: "b1:A1:", label: "A1", sessionSlot: "" }),
    ]);
  });

  it("returns nothing when the tutor has no branch or level", () => {
    expect(teachingGroups(readAssignment({}), names)).toEqual([]);
  });

  it("assignmentHasGroup gates a requested class against the assignment", () => {
    const assignment = readAssignment({
      branchIds: ["b1"],
      levels: ["A1", "B1"],
      sessionSlots: ["morning", "evening"],
      assignmentGroups: [
        { branchId: "b1", level: "A1", sessionSlot: "morning" },
        { branchId: "b1", level: "B1", sessionSlot: "evening" },
      ],
    });
    expect(assignmentHasGroup(assignment, names, { branchId: "b1", level: "b1", sessionSlot: "evening" })?.label).toBe(
      "B1 · Evening",
    );
    expect(assignmentHasGroup(assignment, names, { branchId: "b1", level: "A1", sessionSlot: "evening" })).toBeNull();
  });

  it("parseGroupKey round-trips and rejects junk", () => {
    expect(parseGroupKey("b1:a1:morning")).toEqual({
      branchId: "b1",
      level: "A1",
      sessionSlot: "morning",
      batch: "",
    });
    expect(parseGroupKey("b1:a1:morning:october")).toEqual({
      branchId: "b1",
      level: "A1",
      sessionSlot: "morning",
      batch: "October",
    });
    expect(parseGroupKey("b1:A1")).toBeNull();
    expect(parseGroupKey("b1:A1:morning:Smarch")).toBeNull();
    expect(parseGroupKey("b1:A1:morning:October:extra")).toBeNull();
    expect(parseGroupKey("")).toBeNull();
    expect(parseGroupKey(null)).toBeNull();
  });
});

/**
 * September and October A1 morning overlap for a month: two classes, two
 * timetables. A tutor who teaches both must see two classes — each with its own
 * label, key, live room and students — not one merged card.
 */
describe("teaching groups split by batch", () => {
  const names = new Map([["b1", "Lagos"]]);
  const student = (batch: string | null, extra: Record<string, unknown> = {}) => ({
    branchId: "b1",
    level: "A1",
    sessionSlot: "morning",
    admission: batch ? { batch } : {},
    ...extra,
  });
  const everyIntake = readAssignment({
    branchIds: ["b1"],
    levels: ["A1"],
    sessionSlots: ["morning"],
    assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning" }],
  });

  it("an every-intake group becomes one class per batch the tutor really has students in", () => {
    const roster = [student("October"), student("September"), student("september"), student("October")];
    const groups = teachingGroups(everyIntake, names, "cmtutorA", roster);

    // Chronological: September started first.
    expect(groups.map((group) => group.label)).toEqual([
      "A1 · Morning · September batch",
      "A1 · Morning · October batch",
    ]);
    expect(groups.map((group) => group.key)).toEqual(["b1:A1:morning:September", "b1:A1:morning:October"]);
    expect(groups[0].roomName).toBe("ew-lagos-a1-morning-b-september-t-cmtutora");
    expect(groups[1].roomName).toBe("ew-lagos-a1-morning-b-october-t-cmtutora");
    expect(groups[0].roomName).not.toBe(groups[1].roomName);
  });

  it("without a roster (or with no batches on it) the cohort stays one class, as before", () => {
    expect(teachingGroups(everyIntake, names, "t")).toHaveLength(1);
    expect(teachingGroups(everyIntake, names, "t", [])).toHaveLength(1);
    const unplaced = teachingGroups(everyIntake, names, "t", [student(null), student(null)]);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]).toMatchObject({ key: "b1:A1:morning", batch: null, label: "A1 · Morning" });
  });

  it("two admin-pinned groups of the same sitting are two classes (they used to collapse to one)", () => {
    const assignment = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [
        { branchId: "b1", level: "A1", sessionSlot: "morning", batch: "September" },
        { branchId: "b1", level: "A1", sessionSlot: "morning", batch: "October" },
      ],
    });
    expect(teachingGroups(assignment, names).map((group) => group.batch)).toEqual(["September", "October"]);
  });

  it("a pinned group is never split further, whatever the roster says", () => {
    const assignment = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "October" }],
    });
    const groups = teachingGroups(assignment, names, "t", [student("September"), student("October")]);
    expect(groups.map((group) => group.batch)).toEqual(["October"]);
  });

  it("a flat-list tutor restricted to two months teaches each as its own class", () => {
    const assignment = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      batches: ["September", "October"],
    });
    expect(teachingGroups(assignment, names).map((group) => group.batch)).toEqual(["September", "October"]);
  });

  it("only students in the cohort decide the split — another level's batches do not leak in", () => {
    const roster = [student("October"), student("November", { level: "B1" }), student("December", { branchId: "b9" })];
    expect(teachingGroups(everyIntake, names, "t", roster).map((group) => group.batch)).toEqual(["October"]);
  });

  it("studentsInGroup counts exactly one batch's students; a batch-less class takes the cohort", () => {
    const roster = [student("September"), student("October"), student("October"), student(null)];
    const [sept, oct] = teachingGroups(everyIntake, names, "t", roster);
    expect(studentsInGroup(sept, roster)).toHaveLength(1);
    expect(studentsInGroup(oct, roster)).toHaveLength(2);
    // The student with no batch is in neither batch's class.
    const placed = new Set([...studentsInGroup(sept, roster), ...studentsInGroup(oct, roster)]);
    expect(placed.has(roster[3])).toBe(false);
    const whole = teachingGroups(everyIntake, names, "t")[0];
    expect(studentsInGroup(whole, roster)).toHaveLength(4);
  });

  it("assignmentHasGroup: an every-intake group opens as any batch; a pinned one only as its own", () => {
    const opened = assignmentHasGroup(everyIntake, names, { branchId: "b1", level: "A1", sessionSlot: "morning", batch: "October" }, "t");
    expect(opened).toMatchObject({ batch: "October", key: "b1:A1:morning:October" });

    const pinned = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "September" }],
    });
    const target = { branchId: "b1", level: "A1", sessionSlot: "morning" };
    expect(assignmentHasGroup(pinned, names, { ...target, batch: "September" })?.batch).toBe("September");
    // October is not the batch the office gave this tutor.
    expect(assignmentHasGroup(pinned, names, { ...target, batch: "October" })).toBeNull();
    // An old bookmark with no batch lands on the class the tutor does have.
    expect(assignmentHasGroup(pinned, names, target)?.batch).toBe("September");
    // And a class the office never assigned stays refused.
    expect(assignmentHasGroup(everyIntake, names, { ...target, level: "B1", batch: "October" })).toBeNull();
  });

  it("a tutor pinned to September sees September's community room, not October's", () => {
    const pinned = readAssignment({
      branchIds: ["b1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "September" }],
    });
    expect(spaceWhereForAssignment(pinned)).toEqual({
      OR: [{ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "September" }],
    });
    // An every-intake tutor teaches both and sees both.
    expect(spaceWhereForAssignment(everyIntake)).toEqual({
      OR: [{ branchId: "b1", level: "A1", sessionSlot: "morning" }],
    });
    // The flat lists carry standalone months the same way.
    const flat = readAssignment({ branchIds: ["b1"], levels: ["A1"], batches: ["October"] });
    expect(spaceWhereForAssignment(flat)).toMatchObject({ batch: { in: ["October"] } });
  });
});

describe("batchRangeLabel", () => {
  it("spans the level from its intake month", () => {
    expect(batchRangeLabel("September", "morning")).toBe("September – October");
    expect(batchRangeLabel("August", "evening")).toBe("August – September");
  });

  it("gives a weekend intake three months", () => {
    expect(batchMonthSpan("August", "weekend")).toEqual(["August", "September", "October"]);
    expect(batchRangeLabel("August", "weekend")).toBe("August – October");
  });

  it("wraps the year end", () => {
    expect(batchRangeLabel("December", "morning")).toBe("December – January");
  });

  it("is empty for no batch or an unknown month", () => {
    expect(batchRangeLabel(null, "morning")).toBe("");
    expect(batchRangeLabel("Smarch", "morning")).toBe("");
  });
});
