import { describe, expect, it } from "vitest";
import {
  assignmentBatches,
  belongsToLecturer,
  hasBatchConstraint,
  matchesBatch,
  readAssignment,
  studentWhereForLecturerScope,
} from "./lecturer-assignment";

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
      ],
    });
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
