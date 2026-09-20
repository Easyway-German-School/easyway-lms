import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The profile-details save must never dead-end a student. These pin the ways it
 * used to (and could again) answer "Could not save that": an unreadable 500, a
 * profile row that cannot be written, a stale legacy birth date, and a slow
 * office notice holding the "Done" tap hostage.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  studentUpdate: vi.fn(),
  profileCreate: vi.fn(),
  profileUpdate: vi.fn(),
  guardedProfileUpdate: vi.fn(),
  tenantFind: vi.fn(),
  captureError: vi.fn(),
  notify: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void mocks.afterCallbacks.push(fn) };
});
vi.mock("@/lib/auth", () => ({ requireAuthSession: async () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findUnique: mocks.findUnique, update: mocks.studentUpdate },
    studentProfile: { create: mocks.profileCreate, update: mocks.profileUpdate },
    tenant: { findUnique: mocks.tenantFind },
  },
  guardedPrisma: { studentProfile: { update: mocks.guardedProfileUpdate } },
}));
vi.mock("@/lib/capture-error", () => ({ captureError: mocks.captureError }));
vi.mock("@/lib/notify", () => ({ KIND: { general: "general" }, notify: mocks.notify }));
vi.mock("@/lib/tenant/context", () => ({ runWithTenant: (_id: string, fn: () => unknown) => fn() }));

import { POST } from "./route";

function student(overrides: Record<string, unknown> = {}) {
  return {
    id: "student-1",
    tenantId: "tenant-1",
    admission: { onboardedVia: "manual-add" },
    profile: null,
    user: { name: "Joshua Okoro", tenantId: "tenant-1" },
    ...overrides,
  };
}

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/student/profile/backfill", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

const FULL = {
  whatsapp: "08031234567",
  dateOfBirth: "1968-05-14",
  stateRegion: "Lagos",
  country: "Nigeria",
  emergencyName: "Ada",
  emergencyPhone: "08030000000",
  occupation: "Trader",
  goal: "Ausbildung",
  complete: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.tenantFind.mockResolvedValue({ id: "tenant-1" });
  mocks.profileCreate.mockResolvedValue({});
  mocks.profileUpdate.mockResolvedValue({});
  mocks.studentUpdate.mockResolvedValue({});
  mocks.notify.mockResolvedValue({});
});

describe("POST /api/student/profile/backfill", () => {
  it("saves everything and completes on Done", async () => {
    mocks.findUnique.mockResolvedValue(student());
    const res = await post(FULL);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, done: true, missing: [] });
    expect(mocks.profileCreate).toHaveBeenCalledOnce();
    const admission = mocks.studentUpdate.mock.calls[0][0].data.admission;
    expect(admission.goal).toBe("Ausbildung");
    expect(admission.dob).toBe("1968-05-14");
    expect(admission.profileBackfilledAt).toBeTruthy();
  });

  it("does not run the office notice inside the request", async () => {
    mocks.findUnique.mockResolvedValue(student());
    await post(FULL);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);

    await mocks.afterCallbacks[0]();
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("still succeeds when the office notice fails", async () => {
    mocks.findUnique.mockResolvedValue(student());
    mocks.notify.mockRejectedValue(new Error("smtp down"));
    const res = await post(FULL);
    expect(res.status).toBe(200);
    await expect(Promise.resolve(mocks.afterCallbacks[0]())).resolves.toBeUndefined();
  });

  it("heals a profile row the tenant filter cannot see instead of failing", async () => {
    mocks.findUnique.mockResolvedValue(student({ profile: { id: "p1", studentId: "student-1" } }));
    mocks.profileUpdate.mockRejectedValue(new Error("Record to update not found"));
    mocks.profileCreate.mockRejectedValue(new Error("Unique constraint failed on studentId"));
    mocks.guardedProfileUpdate.mockResolvedValue({});

    const res = await post(FULL);
    expect(res.status).toBe(200);
    expect(mocks.guardedProfileUpdate).toHaveBeenCalledOnce();
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("keeps the answers and reports the fault when the profile row cannot be written at all", async () => {
    mocks.findUnique.mockResolvedValue(student({ profile: { id: "p1", studentId: "student-1" } }));
    mocks.profileUpdate.mockRejectedValue(new Error("boom"));
    mocks.profileCreate.mockRejectedValue(new Error("boom"));
    mocks.guardedProfileUpdate.mockRejectedValue(new Error("boom"));

    const res = await post(FULL);
    expect(res.status).toBe(200);
    expect(mocks.captureError).toHaveBeenCalledWith("profile-backfill:profile-row", expect.any(Error), expect.anything());
    // The blob still carries the answers and the completion mark.
    const admission = mocks.studentUpdate.mock.calls[0][0].data.admission;
    expect(admission.goal).toBe("Ausbildung");
    expect(admission.profileBackfilledAt).toBeTruthy();
  });

  it("drops a stale, unusable birth date instead of refusing the save", async () => {
    mocks.findUnique.mockResolvedValue(student());
    const res = await post({ ...FULL, dateOfBirth: "no idea" });
    expect(res.status).toBe(200);
    const data = mocks.profileCreate.mock.calls[0][0].data;
    expect(data.dateOfBirth).toBeUndefined();
    expect(mocks.studentUpdate.mock.calls[0][0].data.admission.dob).toBeUndefined();
  });

  it("drops an impossible birth date (year 26, tomorrow) rather than storing an age of 2000", async () => {
    mocks.findUnique.mockResolvedValue(student());
    await post({ ...FULL, dateOfBirth: "0026-05-14" });
    expect(mocks.profileCreate.mock.calls[0][0].data.dateOfBirth).toBeUndefined();
  });

  it("answers with readable JSON, and reports it, when something truly unexpected throws", async () => {
    mocks.findUnique.mockResolvedValue(student());
    mocks.studentUpdate.mockRejectedValue(new Error("connection reset"));

    const res = await post(FULL);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/try again/i);
    expect(mocks.captureError).toHaveBeenCalledWith("profile-backfill", expect.any(Error), expect.anything());
  });

  it("snoozes without marking complete on Skip for now, keeping what was typed", async () => {
    mocks.findUnique.mockResolvedValue(student());
    await post({ whatsapp: "08031234567", country: "Nigeria", dismiss: true });
    const admission = mocks.studentUpdate.mock.calls[0][0].data.admission;
    expect(admission.profileBackfillSnoozedUntil).toBeTruthy();
    expect(admission.profileBackfilledAt).toBeUndefined();
    expect(mocks.profileCreate).toHaveBeenCalledOnce();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });
});
