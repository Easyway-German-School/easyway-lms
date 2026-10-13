import { describe, expect, it } from "vitest";
import { resolveBatchAbsolute, resolveBatchWindow } from "./batch";

const absoluteLabel = (absolute: number | null) => {
  if (absolute === null) return null;
  const year = Math.floor(absolute / 12);
  const monthIndex = absolute % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
};

describe("resolveBatchAbsolute", () => {
  it("resolves forward from a recent registration, same-year", () => {
    // A student registering in August for "October" means this October.
    const registeredAt = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-08-15T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { registeredAt, now }))).toBe("2026-10");
  });

  it("resolves forward to NEXT year when the named month has already passed this year", () => {
    // Registering in August for "July" means next July, not the one just gone.
    const registeredAt = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-08-15T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("July", { registeredAt, now }))).toBe("2027-07");
  });

  it("does not re-anchor a registration from under a year ago", () => {
    const registeredAt = new Date("2025-12-01T00:00:00Z");
    const now = new Date("2026-10-13T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { registeredAt, now }))).toBe("2026-10");
  });

  it("re-anchors a stale registration onto the current occurrence of the batch month", () => {
    // A student whose ACCOUNT was created long ago (she did A1 last year) and who
    // is now, `now`, on an "October" batch for her current level. Before the
    // stale-registration guard, this naively resolved to October 2025 — a batch
    // the system then believed had ended nearly a year ago, which is exactly the
    // "dashboard says I've completed a level I haven't started" bug (2026-10-13
    // complaint, mostly hitting A2+ students for this reason).
    const registeredAt = new Date("2025-01-15T00:00:00Z");
    const now = new Date("2026-10-13T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { registeredAt, now }))).toBe("2026-10");
  });

  it("re-anchors a registration exactly one cycle old, same month", () => {
    const registeredAt = new Date("2025-10-05T00:00:00Z");
    const now = new Date("2026-10-13T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { registeredAt, now }))).toBe("2026-10");
  });

  it("re-anchors a registration several cycles old onto the CURRENT occurrence, not just the next one", () => {
    const registeredAt = new Date("2023-01-01T00:00:00Z");
    const now = new Date("2026-10-13T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { registeredAt, now }))).toBe("2026-10");
  });

  it("falls back to the nearest past-or-current occurrence with no registration date", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    expect(absoluteLabel(resolveBatchAbsolute("October", { now }))).toBe("2026-10");
    expect(absoluteLabel(resolveBatchAbsolute("December", { now }))).toBe("2025-12");
  });
});

describe("resolveBatchWindow — the stale-registration bug end to end", () => {
  it("a just-started A2 student's October batch does not read as already ended", () => {
    // She paid 2026-10-05 for A2; her ACCOUNT predates that (she did A1 last year).
    const registeredAt = new Date("2025-02-10T00:00:00Z");
    const now = new Date("2026-10-13T00:00:00Z");
    const window = resolveBatchWindow("October", { registeredAt, now, months: 2 });
    expect(window).not.toBeNull();
    expect(window!.hasEnded).toBe(false);
    expect(window!.label).toContain("2026");
  });
});
