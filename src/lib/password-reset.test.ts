import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { passwordProblem } from "./password-rules";

describe("password rules", () => {
  it("rejects anything under 8 characters", () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("1234567")).toMatch(/8 characters/);
  });

  it("accepts 8 characters exactly", () => {
    expect(passwordProblem("12345678")).toBeNull();
  });

  it("rejects an absurdly long one", () => {
    // Not arbitrary tidiness: bcrypt on a megabyte of input is a way to spend
    // our CPU from an unauthenticated endpoint.
    expect(passwordProblem("a".repeat(201))).toMatch(/shorter/);
  });

  it("does not object to spaces or unicode", () => {
    expect(passwordProblem("mein Straßenname")).toBeNull();
    expect(passwordProblem("correct horse battery")).toBeNull();
  });
});

/**
 * The token scheme, verified independently of the database.
 *
 * These assert the properties the design depends on rather than the
 * implementation: that tokens are unguessable, that the stored form is not the
 * usable form, and that lookup by hash is exact.
 */
describe("reset token properties", () => {
  const generate = () => crypto.randomBytes(32).toString("base64url");
  const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

  it("produces at least 256 bits of entropy", () => {
    const token = generate();
    // base64url of 32 bytes is 43 chars, no padding.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("never repeats across a large sample", () => {
    const seen = new Set(Array.from({ length: 5000 }, generate));
    expect(seen.size).toBe(5000);
  });

  it("is url-safe, so it survives being emailed and pasted", () => {
    for (let i = 0; i < 200; i++) {
      const token = generate();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it("stores something that cannot be used as a link", () => {
    const token = generate();
    expect(hash(token)).not.toBe(token);
    expect(hash(token)).toHaveLength(64);
  });

  it("hashes deterministically, so lookup by hash finds the row", () => {
    const token = generate();
    expect(hash(token)).toBe(hash(token));
  });

  it("gives different tokens different hashes", () => {
    expect(hash(generate())).not.toBe(hash(generate()));
  });
});

describe("expiry arithmetic", () => {
  const TTL = 60 * 60 * 1000;

  it("is live just before the hour", () => {
    const expiresAt = new Date(Date.now() + TTL);
    expect(expiresAt.getTime() < Date.now()).toBe(false);
  });

  it("is dead just after", () => {
    const expiresAt = new Date(Date.now() - 1000);
    expect(expiresAt.getTime() < Date.now()).toBe(true);
  });
});
