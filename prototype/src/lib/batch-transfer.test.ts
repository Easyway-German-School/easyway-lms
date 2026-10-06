import { describe, expect, it, vi } from "vitest";

// batch-transfer.ts is mostly orchestration over the database; what is worth
// pinning here is the pure rules it is built on, so every collaborator that
// touches a database, a queue or the network is stubbed out.
vi.mock("@/lib/prisma", () => ({ prisma: {}, unguardedPrisma: {} }));
vi.mock("@/lib/student-access", () => ({ getStudentAccess: vi.fn() }));
vi.mock("@/lib/student-code", () => ({ realignStudentCodeById: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn(), KIND: { announcement: "announcement" } }));
vi.mock("@/lib/tutor-auto-assign", () => ({ reassignTutorForPlacement: vi.fn() }));
vi.mock("@/lib/prisma-guard", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/intake-server", () => ({ readCurrentIntake: vi.fn() }));

import {
  currentBatchOf,
  defaultDestination,
  formatDestination,
  parseBatchDestination,
  readPendingBatchTransfer,
  withoutPendingBatchTransfer,
  withPendingBatchTransfer,
} from "./batch-transfer";
import { readCurrentIntake } from "@/lib/intake-server";

const NOW = new Date("2026-10-06T12:00:00Z");

describe("parseBatchDestination", () => {
  it("accepts the current month and later", () => {
    const parsed = parseBatchDestination("october", 2026, NOW);
    expect(parsed).toEqual({ ok: true, destination: { month: "October", year: 2026 } });
    expect(parseBatchDestination("January", "2027", NOW).ok).toBe(true);
  });

  it("refuses a batch that has already finished", () => {
    const parsed = parseBatchDestination("August", 2026, NOW);
    expect(parsed.ok).toBe(false);
  });

  it("refuses junk and absurd years", () => {
    expect(parseBatchDestination("Octember", 2026, NOW).ok).toBe(false);
    expect(parseBatchDestination("October", "twenty", NOW).ok).toBe(false);
    expect(parseBatchDestination("October", 2099, NOW).ok).toBe(false);
    expect(parseBatchDestination(undefined, undefined, NOW).ok).toBe(false);
  });
});

describe("the scheduled move on the admission blob", () => {
  it("round-trips and keeps every other admission key", () => {
    const admission = { batch: "August", phone: "0703", photo: "data:..." };
    const scheduled = withPendingBatchTransfer(admission, { month: "October", year: 2026 }, "admin-1");

    expect(readPendingBatchTransfer(scheduled)).toEqual({ month: "October", year: 2026 });
    expect(scheduled.phone).toBe("0703");
    expect(scheduled.batch).toBe("August"); // nothing moves until payment clears
    expect((scheduled.pendingBatchTransfer as { scheduledBy?: string }).scheduledBy).toBe("admin-1");
  });

  it("is removed cleanly, leaving everything else", () => {
    const scheduled = withPendingBatchTransfer({ batch: "August", phone: "0703" }, { month: "October", year: 2026 });
    const cleared = withoutPendingBatchTransfer(scheduled);

    expect(readPendingBatchTransfer(cleared)).toBeNull();
    expect(cleared).toEqual({ batch: "August", phone: "0703" });
  });

  it("ignores a malformed pending move instead of acting on it", () => {
    expect(readPendingBatchTransfer(null)).toBeNull();
    expect(readPendingBatchTransfer({ pendingBatchTransfer: { month: "Octember", year: 2026 } })).toBeNull();
    expect(readPendingBatchTransfer({ pendingBatchTransfer: { month: "October", year: "2026" } })).toBeNull();
  });
});

describe("currentBatchOf", () => {
  it("prefers the explicit year the office set", () => {
    expect(currentBatchOf({ batch: "October", batchYear: 2026 }, new Date("2025-08-12"))).toEqual({
      month: "October",
      year: 2026,
    });
  });

  it("falls back to inferring from the registration date", () => {
    expect(currentBatchOf({ batch: "August" }, new Date("2026-07-20"))).toEqual({ month: "August", year: 2026 });
  });

  it("has no answer without a batch", () => {
    expect(currentBatchOf({}, new Date("2026-07-20"))).toBeNull();
  });
});

describe("defaultDestination", () => {
  it("is the school's current intake when it is still ahead", async () => {
    vi.mocked(readCurrentIntake).mockResolvedValueOnce({ month: "November", year: 2026 });
    expect(await defaultDestination("t1", NOW)).toEqual({ month: "November", year: 2026 });
  });

  it("never lands somebody in a batch that has already finished", async () => {
    // A stale setting - the intake was never moved on from August.
    vi.mocked(readCurrentIntake).mockResolvedValueOnce({ month: "August", year: 2026 });
    expect(await defaultDestination("t1", NOW)).toEqual({ month: "October", year: 2026 });
  });

  it("falls back to the calendar month if the setting cannot be read", async () => {
    vi.mocked(readCurrentIntake).mockRejectedValueOnce(new Error("db down"));
    expect(await defaultDestination("t1", NOW)).toEqual({ month: "October", year: 2026 });
  });
});

describe("formatDestination", () => {
  it("reads the way the office says it", () => {
    expect(formatDestination({ month: "October", year: 2026 })).toBe("October 2026");
  });
});
