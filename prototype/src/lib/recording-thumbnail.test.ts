import { describe, expect, it } from "vitest";
import { buildRecordingThumbnailKey } from "./recording-thumbnail";

describe("buildRecordingThumbnailKey", () => {
  it("keeps the recording name and adds a poster suffix", () => {
    expect(buildRecordingThumbnailKey("recordings/branch/a1/2026-08-21/class.mp4")).toBe(
      "recordings/branch/a1/2026-08-21/class-thumb.jpg",
    );
  });

  it("handles nested names without changing the folder structure", () => {
    expect(buildRecordingThumbnailKey("recordings/branch/a1/2026-08-21/room-2.mp4")).toBe(
      "recordings/branch/a1/2026-08-21/room-2-thumb.jpg",
    );
  });
});
