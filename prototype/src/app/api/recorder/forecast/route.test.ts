import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => ({ version: 1, generatedAt: "2026-10-05T08:00:00.000Z", buckets: [], liveNow: 0, cohorts: 3 })),
  tenant: vi.fn(async () => "tenant-1"),
}));
vi.mock("@/lib/recording-forecast-server", () => ({ loadRecordingForecast: mocks.load }));
vi.mock("@/lib/price-book-server", () => ({ defaultTenantId: mocks.tenant }));
vi.mock("@/lib/tenant/context", () => ({ runWithTenant: (_id: string, fn: () => unknown) => fn() }));

import { GET } from "./route";
import { signRecorderBody } from "@/lib/recorder";

const SECRET = "s".repeat(40);
const ask = (query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`https://lms.example/api/recorder/forecast${query}`, { headers }));
const signed = (query: string, secret = SECRET, ts = String(Date.now())) => ({
  "x-recorder-timestamp": ts,
  "x-recorder-signature": signRecorderBody(secret, ts, query.replace(/^\?/, "")),
});

beforeEach(() => {
  process.env.RECORDER_SHARED_SECRET = SECRET;
  mocks.load.mockClear();
  mocks.tenant.mockResolvedValue("tenant-1");
});

describe("GET /api/recorder/forecast", () => {
  it("is refused without a signature, and the schedule is never read", async () => {
    expect((await ask("?hours=24")).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("is refused with the wrong secret", async () => {
    expect((await ask("?hours=24", signed("?hours=24", "x".repeat(40)))).status).toBe(401);
  });

  it("is refused when the query was changed after signing (the signature covers it)", async () => {
    expect((await ask("?hours=168", signed("?hours=24"))).status).toBe(401);
  });

  it("is refused for a replayed old request", async () => {
    const old = String(Date.now() - 6 * 60_000);
    expect((await ask("?hours=24", signed("?hours=24", SECRET, old))).status).toBe(401);
  });

  it("answers a signed request with the forecast, and tells caches not to keep it", async () => {
    const response = await ask("?hours=24", signed("?hours=24"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).cohorts).toBe(3);
    expect(mocks.load).toHaveBeenCalledWith({ tenantId: "tenant-1", hours: 24 });
  });

  it("defaults to 48 hours", async () => {
    await ask("", signed(""));
    expect(mocks.load).toHaveBeenCalledWith({ tenantId: "tenant-1", hours: 48 });
  });

  it("refuses silly windows", async () => {
    expect((await ask("?hours=0", signed("?hours=0"))).status).toBe(400);
    expect((await ask("?hours=9999", signed("?hours=9999"))).status).toBe(400);
    expect((await ask("?hours=abc", signed("?hours=abc"))).status).toBe(400);
  });

  it("is unavailable when the recorder is not configured at all", async () => {
    delete process.env.RECORDER_SHARED_SECRET;
    expect((await ask("?hours=24", signed("?hours=24"))).status).toBe(503);
  });

  it("reports a server error (not a fake empty forecast) when the schedule cannot be read", async () => {
    mocks.load.mockRejectedValueOnce(new Error("db down"));
    const response = await ask("?hours=24", signed("?hours=24"));
    expect(response.status).toBe(500);
  });
});
