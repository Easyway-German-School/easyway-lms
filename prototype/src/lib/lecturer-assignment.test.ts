import { describe, expect, it } from "vitest";
import { readAssignment, studentWhereForLecturerScope } from "./lecturer-assignment";

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
