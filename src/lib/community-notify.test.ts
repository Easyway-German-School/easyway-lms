import { describe, expect, it } from "vitest";
import { mergeCommunityRecipientIds } from "./community-notify";

describe("mergeCommunityRecipientIds", () => {
  it("keeps student and staff recipients together while removing duplicates and the author", () => {
    expect(
      mergeCommunityRecipientIds(["student-1", "student-2", "staff-1"], ["staff-1", "staff-2", "student-2"], "staff-1"),
    ).toEqual(["student-1", "student-2", "staff-2"]);
  });
});
