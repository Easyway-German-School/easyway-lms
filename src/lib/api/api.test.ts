import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, describeApiKey, hasScope } from "./keys";
import { hashRequest } from "./idempotency";
import { parseLimit } from "./response";

describe("api key format", () => {
  it("is four parts, namespaced and environment-tagged", () => {
    const { plaintext } = generateApiKey("live");
    const parts = plaintext.split("_");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("ewk");
    expect(parts[1]).toBe("live");
  });

  /**
   * The regression guard for the bug that made this suite flaky.
   *
   * The secret was base64url, whose alphabet includes the `_` this format
   * splits on, so about half of all generated keys had five or more parts and
   * were rejected as malformed by resolveApiKey. One sample caught it only
   * every other run; a thousand makes it certain.
   */
  it("never puts the delimiter inside the secret", () => {
    for (let i = 0; i < 1000; i += 1) {
      const parts = generateApiKey("live").plaintext.split("_");
      expect(parts, `key ${i} split into ${parts.length} parts`).toHaveLength(4);
    }
  });

  it("makes test and live distinguishable by eye", () => {
    expect(generateApiKey("test").plaintext).toContain("ewk_test_");
    expect(generateApiKey("live").plaintext).toContain("ewk_live_");
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 2000 }, () => generateApiKey("test").plaintext));
    expect(keys.size).toBe(2000);
  });

  it("stores a hash that is not the key", () => {
    const { plaintext, keyHash } = generateApiKey("live");
    expect(keyHash).not.toBe(plaintext);
    expect(keyHash).toHaveLength(64);
    expect(hashApiKey(plaintext)).toBe(keyHash);
  });

  it("exposes a loggable prefix that leaks no secret", () => {
    const { plaintext, prefix } = generateApiKey("live");
    const described = describeApiKey(plaintext);
    expect(described).toContain(prefix);
    // The secret quarter must not appear in anything we would write to a log.
    expect(described).not.toContain(plaintext.split("_")[3]);
  });

  it("survives being sent in a header", () => {
    for (let i = 0; i < 100; i++) {
      const { plaintext } = generateApiKey("test");
      expect(plaintext).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("scopes fail closed", () => {
  const key = (scopes: string[]) => ({
    id: "k", tenantId: "t", environment: "test" as const, scopes, prefix: "p",
  });

  it("denies when no scopes are present", () => {
    // The whole point: unset means nothing, not everything.
    expect(hasScope(key([]), "students:read")).toBe(false);
  });

  it("denies a scope that was not granted", () => {
    expect(hasScope(key(["payments:read"]), "students:read")).toBe(false);
  });

  it("allows an exact grant", () => {
    expect(hasScope(key(["students:read"]), "students:read")).toBe(true);
  });

  it("allows a resource wildcard", () => {
    expect(hasScope(key(["students:*"]), "students:read")).toBe(true);
    expect(hasScope(key(["students:*"]), "payments:read")).toBe(false);
  });

  it("allows a full wildcard", () => {
    expect(hasScope(key(["*"]), "anything:at:all")).toBe(true);
  });
});

describe("idempotency hashing", () => {
  it("matches for an identical request", () => {
    expect(hashRequest("POST", "/api/v1/x", '{"a":1}')).toBe(
      hashRequest("POST", "/api/v1/x", '{"a":1}'),
    );
  });

  it("differs when the body differs, so a reused key is caught", () => {
    expect(hashRequest("POST", "/api/v1/x", '{"a":1}')).not.toBe(
      hashRequest("POST", "/api/v1/x", '{"a":2}'),
    );
  });

  it("differs when the path differs", () => {
    expect(hashRequest("POST", "/api/v1/x", "{}")).not.toBe(
      hashRequest("POST", "/api/v1/y", "{}"),
    );
  });

  it("differs when the method differs", () => {
    expect(hashRequest("POST", "/api/v1/x", "{}")).not.toBe(
      hashRequest("PUT", "/api/v1/x", "{}"),
    );
  });
});

describe("limit clamping", () => {
  it("falls back when absent or nonsense", () => {
    expect(parseLimit(null)).toBe(25);
    expect(parseLimit("abc")).toBe(25);
    expect(parseLimit("-5")).toBe(25);
    expect(parseLimit("0")).toBe(25);
  });

  it("honours a sane request", () => {
    expect(parseLimit("10")).toBe(10);
  });

  it("caps rather than errors, so one caller cannot ask for the table", () => {
    expect(parseLimit("100000")).toBe(100);
  });
});
