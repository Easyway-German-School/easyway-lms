import { describe, expect, it } from "vitest";
import {
  programmeLabel,
  programmeTypeForPathway,
  programmeWhere,
  pathwayMatchWhere,
} from "./programme-type";

describe("programme type", () => {
  it("folds the spellings the office has actually used", () => {
    expect(programmeTypeForPathway("Exam Preparatory")).toBe("exam_prep");
    expect(programmeTypeForPathway("exam prep")).toBe("exam_prep");
    expect(programmeTypeForPathway("  Exam preparation ")).toBe("exam_prep");
    expect(programmeTypeForPathway("Travel Package")).toBe("travel_package");
    expect(programmeTypeForPathway("Language training")).toBe("language_training");
    expect(programmeTypeForPathway("Study and work in Germany")).toBe("language_training");
    expect(programmeTypeForPathway(null)).toBe("language_training");
  });

  it("labels them the way the filter dropdown does", () => {
    expect(programmeLabel("Exam Preparatory")).toBe("Exam prep");
    expect(programmeLabel("Study route")).toBe("Language training");
    expect(programmeLabel("Travel Package")).toBe("Travel package");
  });

  it("builds a where clause that can find exam prep under every stored spelling", () => {
    expect(programmeWhere("exam_prep")).toMatchObject({
      OR: [
        { pathway: { equals: "Exam Preparatory", mode: "insensitive" } },
        { pathway: { equals: "Exam prep", mode: "insensitive" } },
        { pathway: { equals: "Exam preparation", mode: "insensitive" } },
      ],
    });
  });

  it("treats language training as every student who is not on the other two programmes", () => {
    const where = programmeWhere("language_training") as { NOT: { OR: unknown[] } };
    expect(where.NOT.OR.length).toBeGreaterThan(0);
  });

  it("widens an exam-prep tutor so a student stored as Exam prep is still theirs", () => {
    expect(pathwayMatchWhere(["Exam Preparatory"])).toMatchObject({
      OR: [
        { pathway: { equals: "Exam Preparatory", mode: "insensitive" } },
        { pathway: { equals: "Exam prep", mode: "insensitive" } },
        { pathway: { equals: "Exam preparation", mode: "insensitive" } },
      ],
    });
  });
});
