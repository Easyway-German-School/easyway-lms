import { describe, expect, it } from "vitest";
import { assignmentVisibleToWhere, studentsVisibleToAssignment } from "./student-assignments";

const ONLINE = "branch-online";

const campusStudent = {
  id: "s1",
  level: "A1",
  branchId: "branch-lagos",
  sessionSlot: "afternoon",
  deliveryMode: "physical",
  hybridOnlineSlot: null,
};

const hybridStudent = {
  ...campusStudent,
  id: "s2",
  deliveryMode: "hybrid",
  hybridOnlineSlot: "evening",
};

describe("assignmentVisibleToWhere (what a student may see)", () => {
  it("a physical student only gets the campus match — unchanged from before hybrid combos", () => {
    const where = assignmentVisibleToWhere(campusStudent, ONLINE) as any;
    const sitting = where.AND[0];
    expect(sitting.OR).toBeUndefined();
    expect(JSON.stringify(sitting)).not.toContain(ONLINE);
  });

  it("a hybrid student ALSO matches assignments scoped to the online branch + their online sitting", () => {
    const where = assignmentVisibleToWhere(hybridStudent, ONLINE) as any;
    const sitting = where.AND[0];
    expect(sitting.OR).toHaveLength(2);
    const online = JSON.stringify(sitting.OR[1]);
    expect(online).toContain(ONLINE);
    expect(online).toContain("evening");
    // …and never their campus slot on the online side.
    expect(online).not.toContain("afternoon");
  });

  it("without an online branch id a hybrid student falls back to the campus match (no crash, no widening)", () => {
    const where = assignmentVisibleToWhere(hybridStudent, null) as any;
    expect(where.AND[0].OR).toBeUndefined();
  });

  it("a hybrid student with no online slot yet (hasn't answered the combo popup) gets campus only", () => {
    const where = assignmentVisibleToWhere({ ...hybridStudent, hybridOnlineSlot: null }, ONLINE) as any;
    expect(where.AND[0].OR).toBeUndefined();
  });
});

describe("studentsVisibleToAssignment (who hears about it)", () => {
  it("a campus-scoped assignment is a plain branch+sitting match — hybrids are already covered by their campus columns", () => {
    const where = studentsVisibleToAssignment(
      { level: "A1", branchId: "branch-lagos", sessionSlot: "afternoon" },
      ONLINE,
    ) as any;
    expect(where.branchId).toBe("branch-lagos");
    expect(where.sessionSlot).toBe("afternoon");
    expect(where.OR).toBeUndefined();
  });

  it("an online-scoped assignment reaches online-only students AND hybrid students via hybridOnlineSlot", () => {
    const where = studentsVisibleToAssignment({ level: "A1", branchId: ONLINE, sessionSlot: "evening" }, ONLINE) as any;
    expect(where.OR).toEqual([
      { branchId: ONLINE, sessionSlot: "evening" },
      { deliveryMode: "hybrid", hybridOnlineSlot: "evening" },
    ]);
  });

  it("online-scoped with no sitting means every online sitting, so every hybrid student too", () => {
    const where = studentsVisibleToAssignment({ level: "A1", branchId: ONLINE, sessionSlot: null }, ONLINE) as any;
    expect(where.OR).toEqual([{ branchId: ONLINE }, { deliveryMode: "hybrid" }]);
  });

  it("a school-wide assignment (no branch) drops the branch condition instead of asking for students with no branch", () => {
    const where = studentsVisibleToAssignment({ level: "A1", branchId: null, sessionSlot: null }, ONLINE) as any;
    expect(where.branchId).toBeUndefined();
    expect(where.sessionSlot).toBeUndefined();
    expect(where.status).toBe("active");
  });
});
