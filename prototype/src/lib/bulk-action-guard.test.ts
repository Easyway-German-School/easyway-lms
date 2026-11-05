import { describe, expect, it } from "vitest";
import { BULK_ACTION_WARN_THRESHOLD, checkBulkActionSize } from "./bulk-action-guard";

describe("checkBulkActionSize", () => {
  it("never asks for confirmation at or below the threshold", () => {
    expect(checkBulkActionSize(BULK_ACTION_WARN_THRESHOLD)).toEqual({ needsConfirmation: false });
    expect(checkBulkActionSize(1)).toEqual({ needsConfirmation: false });
  });

  it("asks for confirmation above the threshold when none was given", () => {
    const v = checkBulkActionSize(BULK_ACTION_WARN_THRESHOLD + 1);
    expect(v).toEqual({ needsConfirmation: true, total: BULK_ACTION_WARN_THRESHOLD + 1 });
  });

  it("accepts a confirmation that matches the total exactly", () => {
    expect(checkBulkActionSize(201, 201)).toEqual({ needsConfirmation: false });
  });

  it("rejects a stale confirmation from a different (smaller) total", () => {
    // A confirmation for 193 must not wave through a press that now computes 201 —
    // the exact gap that let the 2026-11-05 incident move more than anyone agreed to.
    const v = checkBulkActionSize(201, 193);
    expect(v).toEqual({ needsConfirmation: true, total: 201 });
  });
});
