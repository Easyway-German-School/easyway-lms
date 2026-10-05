import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstSession, findManySessions, findFirstInvite } = vi.hoisted(() => ({
  findFirstSession: vi.fn(),
  findManySessions: vi.fn(),
  findFirstInvite: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    liveClassSession: { findFirst: findFirstSession, findMany: findManySessions },
    liveClassInvite: { findFirst: findFirstInvite },
  },
}));

import { cohortRoomName } from "./live-classroom";
import { liveSessionForStudent, ownOpenCohortRoom } from "./live-presence";
import { readAssignment, teachingGroups } from "./lecturer-assignment";

/**
 * Two tutors on the same branch + level + sitting used to derive the SAME live
 * room, and the second one to press Start was adopted into the first one's
 * class. The room now carries the tutor.
 */
describe("a tutor's live room", () => {
  const cohort = { branchName: "Lagos", level: "B1", sessionSlot: "morning" };

  it("differs between two tutors on the same cohort", () => {
    const a = cohortRoomName({ ...cohort, lecturerId: "cmtutorA" });
    const b = cohortRoomName({ ...cohort, lecturerId: "cmtutorB" });
    expect(a).not.toBe(b);
  });

  it("is stable for one tutor, so a reload re-derives the same room", () => {
    expect(cohortRoomName({ ...cohort, lecturerId: "cmtutorA" })).toBe(
      cohortRoomName({ ...cohort, lecturerId: "cmtutorA" }),
    );
  });

  it("keeps the cohort-wide name when no tutor is given", () => {
    expect(cohortRoomName(cohort)).toBe("ew-lagos-b1-morning");
    expect(cohortRoomName({ ...cohort, lecturerId: "cmtutorA" })).not.toBe("ew-lagos-b1-morning");
  });

  it("carries through teachingGroups, so the dashboard shows the room the session opens", () => {
    const assignment = readAssignment({ branchId: "b1", level: "B1", sessionSlot: "morning" });
    const names = new Map([["b1", "Lagos"]]);
    const [mine] = teachingGroups(assignment, names, "cmtutorA");
    const [theirs] = teachingGroups(assignment, names, "cmtutorB");
    expect(mine.roomName).toBe(cohortRoomName({ ...cohort, lecturerId: "cmtutorA" }));
    expect(theirs.roomName).not.toBe(mine.roomName);
  });
});

describe("ownOpenCohortRoom", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only ever looks for the asking tutor's own open class", async () => {
    findManySessions.mockResolvedValue([{ roomName: "ew-lagos-b1-morning", batch: null }]);
    const room = await ownOpenCohortRoom("cmtutorA", { branchId: "b1", level: "B1", sessionSlot: "morning" });
    expect(room).toBe("ew-lagos-b1-morning");
    expect(findManySessions.mock.calls[0][0].where).toMatchObject({
      kind: "cohort",
      lecturerId: "cmtutorA",
      branchId: "b1",
      level: "B1",
      sessionSlot: "morning",
      endedAt: null,
    });
  });

  it("returns null when the tutor has nothing open", async () => {
    findManySessions.mockResolvedValue([]);
    expect(await ownOpenCohortRoom("cmtutorA", { branchId: "b1" })).toBeNull();
  });
});

describe("liveSessionForStudent with two tutors live on one cohort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstInvite.mockResolvedValue(null);
  });

  const row = (id: string, lecturerId: string, startedAt: string) => ({
    id,
    roomName: `room-${id}`,
    joinCode: `CODE${id}`,
    kind: "cohort",
    title: "Lagos · B1 · Morning",
    branchId: "b1",
    level: "B1",
    sessionSlot: "morning",
    batch: null,
    privateClassId: null,
    startedAt: new Date(startedAt),
    lecturerId,
    lecturer: { user: { name: `Tutor ${lecturerId}` } },
  });

  const student = {
    id: "s1",
    branchId: "b1",
    level: "B1",
    sessionSlot: "morning",
    classType: "group",
    deliveryMode: "physical",
    branch: { name: "Lagos", mode: "physical" },
  };

  it("sends the student to their own tutor even when the other tutor started later", async () => {
    // findMany is ordered newest-first in the query: tutor B started last.
    findManySessions.mockResolvedValueOnce([
      row("2", "cmtutorB", "2026-09-26T18:05:00Z"),
      row("1", "cmtutorA", "2026-09-26T18:00:00Z"),
    ]);
    const live = await liveSessionForStudent({ ...student, tutorId: "cmtutorA" });
    expect(live?.roomName).toBe("room-1");
  });

  it("falls back to the newest one for a student with no named tutor", async () => {
    findManySessions.mockResolvedValueOnce([
      row("2", "cmtutorB", "2026-09-26T18:05:00Z"),
      row("1", "cmtutorA", "2026-09-26T18:00:00Z"),
    ]);
    const live = await liveSessionForStudent({ ...student, tutorId: null });
    expect(live?.roomName).toBe("room-2");
  });
});

/**
 * September and October A1 morning overlap for a month, so BOTH can be live at
 * once on the same branch + level + sitting. Each class reaches only its own
 * batch's students.
 */
describe("live classes by batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstInvite.mockResolvedValue(null);
  });

  const batchRow = (id: string, batch: string | null, startedAt: string, lecturerId = "cmtutorA") => ({
    id,
    roomName: `room-${id}`,
    joinCode: `CODE${id}`,
    kind: "cohort",
    title: "Lagos · A1 · Morning",
    branchId: "b1",
    level: "A1",
    sessionSlot: "morning",
    batch,
    privateClassId: null,
    startedAt: new Date(startedAt),
    lecturerId,
    lecturer: { user: { name: `Tutor ${lecturerId}` } },
  });

  const base = {
    id: "s1",
    branchId: "b1",
    level: "A1",
    sessionSlot: "morning",
    classType: "group",
    deliveryMode: "physical",
    branch: { name: "Lagos", mode: "physical" },
  };

  // Newest first, as the query orders them: October started after September.
  const both = () => [
    batchRow("oct", "October", "2026-10-05T09:05:00Z"),
    batchRow("sep", "September", "2026-10-05T09:00:00Z"),
  ];

  it("sends a September student to the September class even though October started later", async () => {
    findManySessions.mockResolvedValueOnce(both());
    const live = await liveSessionForStudent({ ...base, admission: { batch: "September" } });
    expect(live?.roomName).toBe("room-sep");
  });

  it("sends an October student to the October class", async () => {
    findManySessions.mockResolvedValueOnce(both());
    const live = await liveSessionForStudent({ ...base, admission: { batch: "October" } });
    expect(live?.roomName).toBe("room-oct");
  });

  it("says nothing is live for a student whose batch is not the one that is on", async () => {
    findManySessions.mockResolvedValueOnce([batchRow("oct", "October", "2026-10-05T09:05:00Z")]);
    const live = await liveSessionForStudent({ ...base, admission: { batch: "September" } });
    expect(live).toBeNull();
  });

  it("still admits a student with no batch on record, and any student to a class with no batch", async () => {
    findManySessions.mockResolvedValueOnce([batchRow("oct", "October", "2026-10-05T09:05:00Z")]);
    expect((await liveSessionForStudent({ ...base, admission: {} }))?.roomName).toBe("room-oct");

    findManySessions.mockResolvedValueOnce([batchRow("old", null, "2026-10-05T09:00:00Z")]);
    expect((await liveSessionForStudent({ ...base, admission: { batch: "September" } }))?.roomName).toBe("room-old");
  });

  it("a caller that never selected the admission blob gets the old behaviour, not a lockout", async () => {
    findManySessions.mockResolvedValueOnce(both());
    expect((await liveSessionForStudent(base))?.roomName).toBe("room-oct");
  });

  it("a student named onto a tutor is not pulled into that tutor's OTHER batch's class", async () => {
    // Cohort query finds nothing for their own batch; the named-tutor query
    // finds the tutor live — but only on the October class.
    findManySessions
      .mockResolvedValueOnce([]) // cohort
      .mockResolvedValueOnce([batchRow("oct", "October", "2026-10-05T09:05:00Z")]); // tutor sessions
    const live = await liveSessionForStudent({ ...base, tutorId: "cmtutorA", admission: { batch: "September" } });
    expect(live).toBeNull();
  });

  it("a tutor's reload lands back in THEIR room for that batch, never their other batch's", async () => {
    findManySessions.mockResolvedValue([
      { roomName: "room-sep", batch: "September" },
      { roomName: "room-oct", batch: "October" },
    ]);
    const cohort = { branchId: "b1", level: "A1", sessionSlot: "morning" };
    expect(await ownOpenCohortRoom("cmtutorA", { ...cohort, batch: "October" })).toBe("room-oct");
    expect(await ownOpenCohortRoom("cmtutorA", { ...cohort, batch: "September" })).toBe("room-sep");
    // The query only ever asks for the batch's room or a pre-batch one in progress.
    expect(findManySessions.mock.calls[0][0].where.OR).toEqual([{ batch: "October" }, { batch: null }]);
  });

  it("a class already running when batches shipped (no batch) is adopted, not split in two", async () => {
    findManySessions.mockResolvedValue([{ roomName: "ew-lagos-a1-morning-t-cmtutora", batch: null }]);
    expect(
      await ownOpenCohortRoom("cmtutorA", { branchId: "b1", level: "A1", sessionSlot: "morning", batch: "October" }),
    ).toBe("ew-lagos-a1-morning-t-cmtutora");
  });

  it("only the session's own batch is buzzed: onlyBatchStudents", async () => {
    const { onlyBatchStudents } = await import("./live-presence");
    const people = [
      { id: "a", admission: { batch: "September" } },
      { id: "b", admission: { batch: "October" } },
      { id: "c", admission: {} },
    ];
    expect(onlyBatchStudents({ batch: "October" }, people).map((p) => p.id)).toEqual(["b"]);
    // A session with no batch rings everyone, as it always did.
    expect(onlyBatchStudents({ batch: null }, people)).toHaveLength(3);
  });
});
