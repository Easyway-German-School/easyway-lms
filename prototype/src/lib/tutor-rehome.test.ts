import { describe, expect, it } from "vitest";
import {
  assignmentToData,
  readAssignment as readStoredAssignment,
} from "./lecturer-assignment";
import {
  assignmentCoversAnySeat,
  lecturerKeepsNamedStudents,
  namedGroupLinkIsStale,
  pickReplacementLecturerId,
} from "./tutor-rehome";

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
const NOW = new Date("2026-11-01T00:00:00.000Z");
const EARLIER = new Date("2026-01-01T00:00:00.000Z");

function student(overrides: Partial<{
  id: string;
  tutorId: string | null;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  hybridOnlineSlot: string | null;
  admission: unknown;
  coTutors: { lecturerId: string }[];
}> = {}) {
  return {
    id: "s1",
    tutorId: null as string | null,
    branchId: LAGOS,
    level: "A1",
    sessionSlot: "morning",
    classType: "group",
    deliveryMode: "physical",
    hybridOnlineSlot: null as string | null,
    admission: { batch: "November" },
    coTutors: [] as { lecturerId: string }[],
    ...overrides,
  };
}

describe("namedGroupLinkIsStale", () => {
  it("keeps a private student named onto a tutor who has no class", () => {
    expect(namedGroupLinkIsStale({ classType: "private", coveredByAssignment: false })).toBe(false);
  });

  it("keeps a group student the tutor's class still covers", () => {
    expect(namedGroupLinkIsStale({ classType: "group", coveredByAssignment: true })).toBe(false);
  });

  it("releases a group student after the class was cleared or they moved sitting", () => {
    expect(namedGroupLinkIsStale({ classType: "group", coveredByAssignment: false })).toBe(true);
  });
});

describe("lecturerKeepsNamedStudents", () => {
  it("only inactive or missing tutors lose their named students automatically", () => {
    expect(lecturerKeepsNamedStudents("active")).toBe(true);
    expect(lecturerKeepsNamedStudents("probation")).toBe(true);
    expect(lecturerKeepsNamedStudents("on_leave")).toBe(true);
    expect(lecturerKeepsNamedStudents("inactive")).toBe(false);
    expect(lecturerKeepsNamedStudents(null)).toBe(false);
    expect(lecturerKeepsNamedStudents(undefined)).toBe(false);
  });
});

describe("assignmentCoversAnySeat — hybrid online co-tutors must survive refresh", () => {
  const campusMorning = readAssignment({
    assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
  });
  const onlineEvening = readAssignment({
    classTypes: ["online"],
    assignmentGroups: [{ branchId: ONLINE, level: "A1", sessionSlot: "evening" }],
  });

  it("keeps an online tutor who only covers the online half of a hybrid student", () => {
    const hybrid = student({
      deliveryMode: "hybrid",
      sessionSlot: "morning",
      hybridOnlineSlot: "evening",
      tutorId: "campus-tutor",
      coTutors: [{ lecturerId: "online-tutor" }],
    });
    // Regression: primary-seat-only coverage returned false here, so Link-all
    // wrote the co-tutor row and the next lecturers GET deleted it again.
    expect(assignmentCoversAnySeat(onlineEvening, hybrid, ONLINE)).toBe(true);
    expect(assignmentCoversAnySeat(campusMorning, hybrid, ONLINE)).toBe(true);
  });

  it("does not keep a campus tutor after their class no longer matches", () => {
    const hybrid = student({
      deliveryMode: "hybrid",
      sessionSlot: "afternoon",
      hybridOnlineSlot: "evening",
    });
    expect(assignmentCoversAnySeat(campusMorning, hybrid, ONLINE)).toBe(false);
  });
});

describe("pickReplacementLecturerId", () => {
  const amaka = {
    id: "amaka",
    assignment: readAssignment({
      assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
      batches: ["November"],
    }),
    startedAt: NOW,
    createdAt: NOW,
  };
  const older = {
    id: "older",
    assignment: readAssignment({
      assignmentGroups: [{ branchId: LAGOS, level: "A1", sessionSlot: "morning" }],
      batches: ["November"],
    }),
    startedAt: EARLIER,
    createdAt: EARLIER,
  };
  const wrongLevel = {
    id: "wrong",
    assignment: readAssignment({
      assignmentGroups: [{ branchId: LAGOS, level: "B1", sessionSlot: "morning" }],
    }),
    startedAt: NOW,
    createdAt: NOW,
  };

  it("returns null when nobody teaches the same course, batch and level", () => {
    expect(pickReplacementLecturerId(student(), [wrongLevel], ONLINE, "adenike")).toBeNull();
  });

  it("picks the only matching active tutor", () => {
    expect(pickReplacementLecturerId(student(), [amaka, wrongLevel], ONLINE, "adenike")).toBe("amaka");
  });

  it("prefers the newest matching tutor when several teach the same class", () => {
    // Regression: unique-match required exactly one, so two active tutors
    // teaching the same batch left the student unlinked on deactivate.
    expect(pickReplacementLecturerId(student(), [older, amaka], ONLINE, "adenike")).toBe("amaka");
  });
});
