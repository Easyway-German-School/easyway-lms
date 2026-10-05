import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidPaystackSignature } from "@/lib/paystack-signature";

const sign = (body: string, key: string) => crypto.createHmac("sha512", key).update(body, "utf8").digest("hex");

describe("isValidPaystackSignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "r1" } });

  it("accepts a body signed with the same key", () => {
    expect(isValidPaystackSignature(body, sign(body, "sk_test_abc"), "sk_test_abc")).toBe(true);
  });

  it("rejects a body signed with a different key", () => {
    expect(isValidPaystackSignature(body, sign(body, "sk_test_other"), "sk_test_abc")).toBe(false);
  });

  it("rejects a body that was changed after signing", () => {
    const signature = sign(body, "sk_test_abc");
    expect(isValidPaystackSignature(body.replace("r1", "r2"), signature, "sk_test_abc")).toBe(false);
  });

  it("rejects a missing signature, a missing key, and a wrong-length signature", () => {
    expect(isValidPaystackSignature(body, null, "sk_test_abc")).toBe(false);
    expect(isValidPaystackSignature(body, sign(body, "sk_test_abc"), null)).toBe(false);
    expect(isValidPaystackSignature(body, sign(body, "sk_test_abc"), "")).toBe(false);
    expect(isValidPaystackSignature(body, "abc", "sk_test_abc")).toBe(false);
  });
});
