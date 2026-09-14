import { describe, expect, it } from "vitest";
import {
  assignmentBatches,
  assignmentHasGroup,
  belongsToLecturer,
  hasBatchConstraint,
  matchesBatch,
  parseGroupKey,
  readAssignment,
  studentWhereForLecturerScope,
  teachingGroups,
} from "./lecturer-assignment";
import { batchMonthSpan, batchRangeLabel } from "./levels";

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
    expect(groups.map((group) => group.key)).toEqual(["b1:A1:morning", "b1:B1:evening"]);
    expect(groups[0]).toMatchObject({
      branchName: "Lagos",
      label: "A1 · Morning",
      batch: "August",
      batchRange: "August – September",
      roomName: "ew-lagos-a1-morning",
    });
    expect(groups[1].batchRange).toBe("September – October");
    expect(groups[1].roomName).toBe("ew-lagos-b1-evening");
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
    expect(parseGroupKey("b1:a1:morning")).toEqual({ branchId: "b1", level: "A1", sessionSlot: "morning" });
    expect(parseGroupKey("b1:A1")).toBeNull();
    expect(parseGroupKey("")).toBeNull();
    expect(parseGroupKey(null)).toBeNull();
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
