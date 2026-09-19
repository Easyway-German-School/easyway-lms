import { describe, expect, it } from "vitest";
import { redirectTtlSeconds } from "./storage";

const SIX_HOURS = 6 * 60 * 60;
const ONE_HOUR = 60 * 60;

describe("redirectTtlSeconds", () => {
  it("redirects recording videos for six hours", () => {
    expect(redirectTtlSeconds("recordings/2026/a1-class.mp4")).toBe(SIX_HOURS);
    expect(redirectTtlSeconds("recordings/x.WEBM")).toBe(SIX_HOURS);
  });

  it("keeps recording posters on the proxy", () => {
    expect(redirectTtlSeconds("recordings/2026/a1-class-thumb.jpg")).toBeNull();
  });

  it("redirects material video and audio for six hours", () => {
    expect(redirectTtlSeconds("materials/1-abc-lesson.mp4")).toBe(SIX_HOURS);
    expect(redirectTtlSeconds("materials/1-abc-dialog.mp3")).toBe(SIX_HOURS);
  });

  it("redirects other material files for an hour", () => {
    expect(redirectTtlSeconds("materials/1-abc-workbook.pdf")).toBe(ONE_HOUR);
    expect(redirectTtlSeconds("materials/1-abc-slides.pptx")).toBe(ONE_HOUR);
  });

  it("never redirects private uploads", () => {
    expect(redirectTtlSeconds("photos/1-abc-passport.pdf")).toBeNull();
    expect(redirectTtlSeconds("photos/1-abc-selfie.jpg")).toBeNull();
    expect(redirectTtlSeconds("files/1-abc-handin.mp4")).toBeNull();
    expect(redirectTtlSeconds("work-drive/1-abc-payroll.xlsx")).toBeNull();
  });
});
