import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const update = vi.fn(async () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: { liveClassSession: { findMany, update } },
}));

/**
 * The admin Live classes page once showed the same class twice — one of them "live"
 * for 39 hours with nobody in it. The heartbeat refreshed EVERY open row for the
 * room, so a class abandoned without being ended was kept alive by the next
 * class's heartbeats.
 */
describe("touchLiveSession", () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockClear();
  });

  it("refreshes only the newest open session and closes the abandoned one at its last-seen time", async () => {
    const abandonedSeen = new Date("2026-09-19T08:05:00Z");
    findMany.mockResolvedValue([
      { id: "new", lastSeenAt: new Date() },
      { id: "old", lastSeenAt: abandonedSeen },
    ]);

    const { touchLiveSession } = await import("./live-presence");
    await touchLiveSession("online-b1-morning");

    const calls = update.mock.calls as unknown as Array<[{ where: { id: string }; data: Record<string, unknown> }]>;
    const touched = calls.find(([arg]) => arg.where.id === "new")![0];
    expect(touched.data.lastSeenAt).toBeInstanceOf(Date);
    expect(touched.data.endedAt).toBeUndefined();

    const closed = calls.find(([arg]) => arg.where.id === "old")![0];
    expect(closed.data).toEqual({ endedAt: abandonedSeen });
    expect(closed.data.lastSeenAt).toBeUndefined();
  });

  it("does nothing when nothing is open", async () => {
    findMany.mockResolvedValue([]);
    const { touchLiveSession } = await import("./live-presence");
    await touchLiveSession("empty-room");
    expect(update).not.toHaveBeenCalled();
  });
});
