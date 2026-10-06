import { describe, expect, it } from "vitest";
import { resolveBatchWindow } from "./batch";

describe("explicit batch year", () => {
  it("uses the selected destination year instead of inferring from registration", () => {
    const window = resolveBatchWindow("October", {
      registeredAt: new Date("2025-08-12T00:00:00.000Z"),
      batchYear: 2026,
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(window?.year).toBe(2026);
    expect(window?.hasBegun).toBe(false);
    expect(window?.daysUntilStart).toBeGreaterThan(0);
  });

  it("keeps registration-based inference when no year is stored", () => {
    const window = resolveBatchWindow("October", {
      registeredAt: new Date("2025-08-12T00:00:00.000Z"),
      now: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(window?.year).toBe(2025);
  });
});