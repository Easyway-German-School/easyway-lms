import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  lecturer: { findUnique: vi.fn() },
  student: { findUnique: vi.fn() },
  betaFeedback: { findMany: vi.fn() },
  liveClassInvite: { findMany: vi.fn() },
  liveClassSession: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/notify", () => ({ notifyInBackground: vi.fn(), KIND: { liveFeedbackAsk: "x" } }));

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

/** A finished class that ran `minutes` long, ended `endedAgo` ms ago. */
const session = (id: string, minutes: number, endedAgo = HOUR) => ({
  id,
  title: `Class ${id}`,
  startedAt: ago(endedAgo + minutes * 60_000),
  endedAt: ago(endedAgo),
  lastSeenAt: ago(endedAgo),
});

// The first import pulls in live-presence's module graph; give a cold, busy machine room.
vi.setConfig({ testTimeout: 30_000 });

describe("feedbackDue", () => {
  beforeEach(() => {
    Object.values(db).forEach((table) => Object.values(table).forEach((fn) => fn.mockReset()));
    db.lecturer.findUnique.mockResolvedValue(null);
    db.student.findUnique.mockResolvedValue({ id: "s1" });
    db.betaFeedback.findMany.mockResolvedValue([]);
  });

  it("asks a student about the class they just left", async () => {
    db.liveClassInvite.findMany.mockResolvedValue([{ session: session("a", 60) }]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "a", role: "student" });
  });

  it("asks a tutor too, under the tutor's own kind", async () => {
    db.student.findUnique.mockResolvedValue(null);
    db.lecturer.findUnique.mockResolvedValue({ id: "l1" });
    db.liveClassSession.findMany.mockResolvedValue([session("t", 45)]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "t", role: "tutor" });
    expect(db.betaFeedback.findMany.mock.calls[0][0].where.kind).toBe("live_class_tutor");
  });

  it("does not ask while the class is still running", async () => {
    db.liveClassInvite.findMany.mockResolvedValue([
      { session: { ...session("live", 60), endedAt: null, lastSeenAt: new Date() } },
    ]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toBeNull();
  });

  it("asks about a class whose tutor simply vanished (no end, quiet heartbeat)", async () => {
    db.liveClassInvite.findMany.mockResolvedValue([
      { session: { ...session("lapsed", 60), startedAt: ago(4 * HOUR), endedAt: null, lastSeenAt: ago(2 * HOUR) } },
    ]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "lapsed" });
  });

  it("ignores a two-minute test session", async () => {
    db.liveClassInvite.findMany.mockResolvedValue([{ session: session("blip", 2) }]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toBeNull();
  });

  it("skips a class already rated and offers the next one", async () => {
    db.betaFeedback.findMany.mockResolvedValue([{ path: "/live/a · Class a", createdAt: ago(100 * HOUR) }]);
    db.liveClassInvite.findMany.mockResolvedValue([{ session: session("a", 60) }, { session: session("b", 60) }]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "b" });
  });

  it("leaves a student alone for three days after they answer, a tutor for one", async () => {
    db.liveClassInvite.findMany.mockResolvedValue([{ session: session("b", 60) }]);
    db.betaFeedback.findMany.mockResolvedValue([{ path: "/live/old · x", createdAt: ago(24 * HOUR) }]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1")).toBeNull();

    db.betaFeedback.findMany.mockResolvedValue([{ path: "/live/old · x", createdAt: ago(80 * HOUR) }]);
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "b" });

    db.student.findUnique.mockResolvedValue(null);
    db.lecturer.findUnique.mockResolvedValue({ id: "l1" });
    db.liveClassSession.findMany.mockResolvedValue([session("t", 60)]);
    db.betaFeedback.findMany.mockResolvedValue([{ path: "/live/old · x", createdAt: ago(30 * HOUR) }]);
    expect(await feedbackDue("u1")).toMatchObject({ sessionId: "t" });
  });

  it("never asks somebody who was not in the class", async () => {
    db.student.findUnique.mockResolvedValue({ id: "s1" });
    db.liveClassInvite.findMany.mockResolvedValue([{ session: session("a", 60) }]);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("u1", { sessionId: "someone-elses" })).toBeNull();
  });

  it("never asks an account that is neither a student nor a tutor (an observing admin)", async () => {
    db.student.findUnique.mockResolvedValue(null);
    const { feedbackDue } = await import("./live-feedback");
    expect(await feedbackDue("admin")).toBeNull();
  });
});
