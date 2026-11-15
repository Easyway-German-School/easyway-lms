import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthSession: vi.fn(),
  loadPortalUpdates: vi.fn(async () => ({ updates: [], unread: 0, now: "2026-11-15T12:00:00.000Z" })),
}));
vi.mock("@/lib/auth", () => ({ requireAuthSession: mocks.requireAuthSession }));
vi.mock("@/lib/portal-updates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/portal-updates")>("@/lib/portal-updates");
  return { ...actual, loadPortalUpdates: mocks.loadPortalUpdates };
});

import { GET } from "./route";

const ask = (query = "") => GET(new Request(`https://lms.example/api/portal/updates${query}`));

beforeEach(() => {
  mocks.requireAuthSession.mockReset();
  mocks.loadPortalUpdates.mockClear();
});

describe("GET /api/portal/updates", () => {
  it("is quietly empty for a signed-out visitor — a closed tab is not an error", async () => {
    mocks.requireAuthSession.mockResolvedValue(null);
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ updates: [], unread: 0 }));
    expect(mocks.loadPortalUpdates).not.toHaveBeenCalled();
  });

  it("delegates to loadPortalUpdates with the signed-in user and role", async () => {
    mocks.requireAuthSession.mockResolvedValue({ user: { id: "user-1", role: "student" } });
    const since = new Date(Date.now() - 60_000); // a minute ago — well inside the 1h clamp floor
    await ask(`?since=${since.toISOString()}`);
    expect(mocks.loadPortalUpdates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", role: "student", since }),
    );
  });

  it("never 500s on a failure — this runs on a timer forever", async () => {
    mocks.requireAuthSession.mockResolvedValue({ user: { id: "user-1", role: "student" } });
    mocks.loadPortalUpdates.mockRejectedValueOnce(new Error("db down"));
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ updates: [], unread: 0 }));
  });
});
