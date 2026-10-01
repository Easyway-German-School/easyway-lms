import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { ok: true, session: { user: { name: "Mary", email: "mary@school.test" } } } as unknown,
  stored: null as string | null,
  putFail: false,
}));

vi.mock("@/lib/admin-roles", () => ({ requireCapability: vi.fn(async () => h.gate) }));
vi.mock("@/lib/storage", () => ({
  getFile: vi.fn(async () => (h.stored === null ? null : new Response(h.stored))),
  putFile: vi.fn(async (input: { body: Buffer }) => {
    if (h.putFail) throw new Error("bucket down");
    h.stored = input.body.toString();
    return "x";
  }),
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x/api/admin/recorder/control", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  h.gate = { ok: true, session: { user: { name: "Mary", email: "mary@school.test" } } };
  h.stored = null;
  h.putFail = false;
  process.env.RECORDING_BACKEND = "recorder";
  process.env.RECORDER_FLEET = "1";
  process.env.RECORDER_SHARED_SECRET = "s".repeat(40);
});

describe("POST /api/admin/recorder/control", () => {
  it("turns away someone without the capability, and writes nothing", async () => {
    h.gate = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await post({ paused: true })).status).toBe(403);
    expect(h.stored).toBeNull();
  });

  it("pauses, recording who did it, and stores the file the scheduler reads", async () => {
    const response = await post({ paused: true, pauseNote: "checking the bill" });
    expect(response.status).toBe(200);
    expect(JSON.parse(h.stored!)).toMatchObject({ version: 1, paused: true, pauseNote: "checking the bill", updatedBy: "Mary" });
  });

  it("builds on what is already stored: adding a day off keeps the pause", async () => {
    await post({ paused: true });
    await post({ addSkipDate: "2026-12-25" });
    expect(JSON.parse(h.stored!)).toMatchObject({ paused: true, skipDates: ["2026-12-25"] });
  });

  it("refuses a bad request with a plain message and changes nothing", async () => {
    const response = await post({ boost: { classes: 99, hours: 1 } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/between 1 and 12/);
    expect(h.stored).toBeNull();
  });

  it("refuses non-JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("says so, and changes nothing, when the file cannot be saved", async () => {
    h.putFail = true;
    const response = await post({ paused: true });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/Nothing was changed/);
  });

  it("is refused while the fleet is not switched on", async () => {
    delete process.env.RECORDER_FLEET;
    expect((await post({ paused: true })).status).toBe(409);
  });
});
