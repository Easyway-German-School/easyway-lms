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
    findFirstSession.mockResolvedValue({ roomName: "ew-lagos-b1-morning" });
    const room = await ownOpenCohortRoom("cmtutorA", { branchId: "b1", level: "B1", sessionSlot: "morning" });
    expect(room).toBe("ew-lagos-b1-morning");
    expect(findFirstSession.mock.calls[0][0].where).toMatchObject({
      kind: "cohort",
      lecturerId: "cmtutorA",
      branchId: "b1",
      level: "B1",
      sessionSlot: "morning",
      endedAt: null,
    });
  });

  it("returns null when the tutor has nothing open", async () => {
    findFirstSession.mockResolvedValue(null);
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
