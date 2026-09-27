import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A raised hand used to be written by the browser calling LiveKit's client
 * SDK directly, under a grant (`canUpdateOwnMetadata`) that also let any
 * participant rewrite their own `metadata` — the field the whole room
 * protocol trusts to decide who is a tutor. This route replaces that direct
 * write with a server-mediated one: the browser asks, the server checks the
 * room is live, and only the server's own LiveKit credentials touch the
 * attribute. These pin the shape of that trade — no session, no room, no
 * live class, or the identity is anyone but the caller, and nothing is
 * written.
 */

const mocks = vi.hoisted(() => ({
  requireAuthSession: vi.fn(),
  findFirstSession: vi.fn(),
  updateParticipant: vi.fn(),
  roomServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuthSession: mocks.requireAuthSession }));
vi.mock("@/lib/prisma", () => ({
  prisma: { liveClassSession: { findFirst: mocks.findFirstSession } },
}));
vi.mock("@/lib/live-moderation", () => ({ roomServiceClient: mocks.roomServiceClient }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/live/hand", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("POST /api/live/hand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findFirstSession.mockResolvedValue({ id: "session-1" });
    mocks.roomServiceClient.mockReturnValue({ updateParticipant: mocks.updateParticipant });
    mocks.updateParticipant.mockResolvedValue({});
  });

  it("rejects a signed-out caller before touching LiveKit", async () => {
    mocks.requireAuthSession.mockResolvedValue(null);
    const res = await post({ roomName: "ew-lagos-a1-morning-t-x", raised: true });
    expect(res.status).toBe(401);
    expect(mocks.updateParticipant).not.toHaveBeenCalled();
  });

  it("rejects a room that is not actually live", async () => {
    mocks.findFirstSession.mockResolvedValue(null);
    const res = await post({ roomName: "ew-lagos-a1-morning-t-x", raised: true });
    expect(res.status).toBe(404);
    expect(mocks.updateParticipant).not.toHaveBeenCalled();
  });

  it("writes ONLY the caller's own identity, never one supplied by the request", async () => {
    await post({ roomName: "ew-lagos-a1-morning-t-x", raised: true, identity: "someone-else" });
    expect(mocks.updateParticipant).toHaveBeenCalledTimes(1);
    const [room, identity, options] = mocks.updateParticipant.mock.calls[0];
    expect(room).toBe("ew-lagos-a1-morning-t-x");
    expect(identity).toBe("user-1");
    expect(options.attributes.handRaisedAt).toMatch(/^\d+$/);
  });

  it("clears the attribute (empty string, not omitted) when lowering", async () => {
    await post({ roomName: "ew-lagos-a1-morning-t-x", raised: false });
    const [, , options] = mocks.updateParticipant.mock.calls[0];
    expect(options.attributes.handRaisedAt).toBe("");
  });

  it("answers ok:false rather than 500 when the participant already left", async () => {
    mocks.updateParticipant.mockRejectedValue(new Error("participant not found"));
    const res = await post({ roomName: "ew-lagos-a1-morning-t-x", raised: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("rejects a request with no room", async () => {
    const res = await post({ raised: true });
    expect(res.status).toBe(400);
    expect(mocks.updateParticipant).not.toHaveBeenCalled();
  });
});
