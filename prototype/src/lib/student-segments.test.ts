import { describe, expect, it } from "vitest";

import { deriveSegments, normalizeStudentType } from "./student-segments";

describe("student type classification", () => {
  const student = {
    status: "active",
    classType: "private",
    deliveryMode: "online",
    heldBackAt: null,
    classesStartedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("uses enrolment history unless an explicit type is set", () => {
    expect(deriveSegments({ ...student, enrolmentCount: 1 })).toContain("new");
    expect(deriveSegments({ ...student, enrolmentCount: 2 })).toContain("returning");
    expect(deriveSegments({ ...student, enrolmentCount: 1, studentType: "returning" })).toContain("returning");
    expect(deriveSegments({ ...student, enrolmentCount: 2, studentType: "new" })).toContain("new");
  });

  it("normalizes only supported student types", () => {
    expect(normalizeStudentType(" NEW ")).toBe("new");
    expect(normalizeStudentType("returning")).toBe("returning");
    expect(normalizeStudentType("hybrid")).toBeNull();
    expect(normalizeStudentType(null)).toBeNull();
  });
});
