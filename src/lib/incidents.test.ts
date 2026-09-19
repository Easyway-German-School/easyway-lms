import { describe, expect, it } from "vitest";
import { fingerprintOf, normaliseMessage, scrub, severityFor } from "./incidents";

describe("scrub", () => {
  it("removes emails, tokens, connection strings and phone numbers", () => {
    const out = scrub(
      "failed for ada@example.com with Bearer abc.def.ghi at postgresql://u:p@host/db call +234 803 123 4567",
    );
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("postgresql://");
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("803 123");
    expect(out).toContain("[email]");
  });
});

describe("fingerprintOf", () => {
  const base = { kind: "error" as const, route: "/api/student/access" };

  it("is the same for the same failure with a different id in it", () => {
    const a = fingerprintOf({ ...base, message: "Student clx1234567890abcdefghijkl not found (attempt 3)" });
    const b = fingerprintOf({ ...base, message: "Student cmy9876543210zyxwvutsrqpo not found (attempt 41)" });
    expect(a).toBe(b);
  });

  it("differs when the failure is genuinely different", () => {
    const a = fingerprintOf({ ...base, message: "Connection terminated" });
    const b = fingerprintOf({ ...base, message: "Unique constraint failed" });
    expect(a).not.toBe(b);
  });

  it("differs by route, so one bad route does not swallow another's incidents", () => {
    expect(fingerprintOf({ ...base, message: "boom" })).not.toBe(
      fingerprintOf({ kind: "error", route: "/api/live/session", message: "boom" }),
    );
  });

  it("folds differently-worded complaints about the same page together", () => {
    const a = fingerprintOf({ kind: "complaint", route: "/live", message: "bug: the video freezes" });
    const b = fingerprintOf({ kind: "complaint", route: "/live", message: "improve: I can't hear the tutor" });
    expect(a).toBe(b);
  });

  it("does not fold pathless complaints together regardless of wording", () => {
    const a = fingerprintOf({ kind: "complaint", route: null, message: "bug: the video freezes" });
    const b = fingerprintOf({ kind: "complaint", route: null, message: "improve: fonts too small" });
    expect(a).not.toBe(b);
  });
});

describe("normaliseMessage", () => {
  it("is bounded", () => {
    expect(normaliseMessage("x ".repeat(2000)).length).toBeLessThanOrEqual(240);
  });
});

describe("severityFor", () => {
  it("treats money and the access gate as more serious than a generic route", () => {
    expect(severityFor({ kind: "error", source: "request", route: "/api/paystack/webhook" })).toBe("critical");
    expect(severityFor({ kind: "error", source: "request", route: "/api/student/access" })).toBe("high");
    expect(severityFor({ kind: "error", source: "request", route: "/api/student/notes" })).toBe("medium");
  });

  it("treats drift as high and a plain complaint as low", () => {
    expect(severityFor({ kind: "drift", source: "invariant", route: "/anything" })).toBe("high");
    expect(severityFor({ kind: "complaint", source: "feedback", route: "/dashboard" })).toBe("low");
  });
});
