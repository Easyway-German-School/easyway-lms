import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintPushToken, verifyPushToken, PUSH_TOKEN_TTL_MS } from "./push-auth";

const SECRET = "s".repeat(40);

describe("push-auth", () => {
  it("round-trips a freshly minted token", () => {
    const token = mintPushToken("user-1", SECRET);
    expect(verifyPushToken(token, SECRET)).toEqual({ ok: true, userId: "user-1" });
  });

  it("refuses a token signed with a different secret", () => {
    const token = mintPushToken("user-1", SECRET);
    expect(verifyPushToken(token, "x".repeat(40)).ok).toBe(false);
  });

  it("refuses a tampered userId (the signature covers it)", () => {
    const token = mintPushToken("user-1", SECRET);
    const [, expiresAt, signature] = token.split(".");
    expect(verifyPushToken(`user-2.${expiresAt}.${signature}`, SECRET).ok).toBe(false);
  });

  it("refuses an expired token", () => {
    const now = Date.now();
    const token = mintPushToken("user-1", SECRET, now);
    const verdict = verifyPushToken(token, SECRET, now + PUSH_TOKEN_TTL_MS + 1);
    expect(verdict).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts a token right at its expiry boundary", () => {
    const now = Date.now();
    const token = mintPushToken("user-1", SECRET, now);
    expect(verifyPushToken(token, SECRET, now + PUSH_TOKEN_TTL_MS).ok).toBe(true);
  });

  it("refuses malformed tokens", () => {
    expect(verifyPushToken("not-a-token", SECRET).ok).toBe(false);
    expect(verifyPushToken("a.b", SECRET).ok).toBe(false);
    expect(verifyPushToken("a.notanumber.sig", SECRET).ok).toBe(false);
  });

  it("never lets a recorder-style signature pass as a push token", () => {
    // Different purpose string folded into the HMAC input — even with the
    // same secret, a signature made for one scheme must not verify for the other.
    const crossPurposeSignature = createHmac("sha256", SECRET)
      .update(`some-other-purpose.user-1.${Date.now() + PUSH_TOKEN_TTL_MS}`)
      .digest("hex");
    const expiresAt = Date.now() + PUSH_TOKEN_TTL_MS;
    expect(verifyPushToken(`user-1.${expiresAt}.${crossPurposeSignature}`, SECRET).ok).toBe(false);
  });
});
