import { describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage, isReactionKind, REACTIONS } from "./live-room-protocol";

describe("live-class reactions", () => {
  it("accepts every reaction in the expanded set over the room protocol", () => {
    for (const kind of REACTIONS) {
      expect(isReactionKind(kind)).toBe(true);
      expect(decodeMessage(encodeMessage({ t: "reaction", kind }), "student")).toEqual({
        t: "reaction",
        kind,
      });
    }
  });

  it("continues to reject unknown reaction kinds", () => {
    expect(isReactionKind("unknown")).toBe(false);
    const invalidMessage = new TextEncoder().encode(JSON.stringify({ t: "reaction", kind: "unknown" }));
    expect(decodeMessage(invalidMessage, "student")).toBeNull();
  });
});
