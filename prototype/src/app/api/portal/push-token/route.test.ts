import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuthSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthSession: mocks.requireAuthSession }));

import { GET } from "./route";
import { verifyPushToken } from "@/lib/push-auth";

const SECRET = "s".repeat(40);

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  mocks.requireAuthSession.mockReset();
});

describe("GET /api/portal/push-token", () => {
  it("refuses a signed-out visitor", async () => {
    mocks.requireAuthSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("mints a token that verifies for this user", async () => {
    mocks.requireAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { token: string; expiresInMs: number };
    expect(verifyPushToken(body.token, SECRET)).toEqual({ ok: true, userId: "user-1" });
    expect(body.expiresInMs).toBeGreaterThan(0);
  });

  it("is unavailable if NEXTAUTH_SECRET is missing", async () => {
    delete process.env.NEXTAUTH_SECRET;
    mocks.requireAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    expect((await GET()).status).toBe(503);
  });
});
