import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LOGO_MARK_PNG_BASE64, STAMP_PNG_BASE64 } from "./brand-assets";

describe("brand-assets", () => {
  it("is valid UTF-8 source — webpack refuses the whole build otherwise", () => {
    const bytes = readFileSync(path.join(__dirname, "brand-assets.ts"));
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).not.toThrow();
  });

  it("embeds two real PNGs", () => {
    for (const b64 of [LOGO_MARK_PNG_BASE64, STAMP_PNG_BASE64]) {
      const head = Buffer.from(b64, "base64").subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });
});
