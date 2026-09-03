import { afterEach, beforeEach, describe as suite, expect, it, vi } from "vitest";

/**
 * `validateSignupAccess` is the whole security boundary for public signup — if
 * it returns `{ valid: true }` for the wrong input, someone gets a student
 * account without going through enrolment or paying the registration fee. Both
 * paths (returning-student token, new-student paid Paystack ref) and every way
 * they can fail are exercised here.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    signupToken: { findUnique: vi.fn() },
    payment: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { validateSignupAccess, signInviteParams, verifyInviteSig } from "@/lib/signup-access";

const tokenFindUnique = prisma.signupToken.findUnique as unknown as ReturnType<typeof vi.fn>;
const paymentFindFirst = prisma.payment.findFirst as unknown as ReturnType<typeof vi.fn>;

const OLD_ENV = { ...process.env };

function paystackResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  tokenFindUnique.mockReset();
  paymentFindFirst.mockReset();
  paymentFindFirst.mockResolvedValue(null);
  process.env = { ...OLD_ENV, PAYSTACK_SECRET_KEY: "sk_test_x" };
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...OLD_ENV };
});

suite("validateSignupAccess — nothing supplied", () => {
  it("is invalid with reason 'missing'", async () => {
    const result = await validateSignupAccess({ token: null, ref: null });
    expect(result).toMatchObject({ valid: false, reason: "missing" });
  });
});

suite("validateSignupAccess — token path", () => {
  it("accepts an unused, unexpired token and returns its prefill + email", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_1",
      email: "ada@example.com",
      name: "Ada",
      level: "A2",
      branchId: "br_1",
      sessionSlot: "morning",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await validateSignupAccess({ token: "raw-token", ref: null });

    expect(result.valid).toBe(true);
    expect(result.source).toBe("token");
    expect(result.email).toBe("ada@example.com");
    expect(result.tokenId).toBe("tok_1");
    expect(result.prefill).toMatchObject({ name: "Ada", email: "ada@example.com", level: "A2" });
  });

  it("rejects a token that matched nothing", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const result = await validateSignupAccess({ token: "nope", ref: null });
    expect(result).toMatchObject({ valid: false, source: "token", reason: "not_found" });
  });

  it("rejects an already-used token", async () => {
    tokenFindUnique.mockResolvedValue({ id: "t", email: "x@y.com", used: true, expiresAt: null });
    const result = await validateSignupAccess({ token: "spent", ref: null });
    expect(result).toMatchObject({ valid: false, reason: "used" });
  });

  it("rejects an expired token", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "t",
      email: "x@y.com",
      used: false,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const result = await validateSignupAccess({ token: "old", ref: null });
    expect(result).toMatchObject({ valid: false, reason: "expired" });
  });
});

suite("validateSignupAccess — Paystack ref path", () => {
  it("accepts a successful charge at or above the registration fee", async () => {
    tokenFindUnique.mockResolvedValue(null); // no consumption marker
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      paystackResponse({
        data: {
          status: "success",
          amount: 500_000, // ₦5,000 in kobo
          currency: "NGN",
          customer: { email: "New@Example.com" },
          metadata: { name: "New Student" },
        },
      }),
    );

    const result = await validateSignupAccess({ token: null, ref: "psk-ref-1" });

    expect(result.valid).toBe(true);
    expect(result.source).toBe("ref");
    expect(result.ref).toBe("psk-ref-1");
    expect(result.email).toBe("new@example.com");
    expect(result.refAmountNaira).toBe(5000);
  });

  it("rejects a ref already recorded as a consumption marker", async () => {
    tokenFindUnique.mockResolvedValue({ id: "m", paystackRef: "psk-ref-1", used: true });
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-1" });
    expect(result).toMatchObject({ valid: false, reason: "ref_consumed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a ref that already has a Payment row", async () => {
    tokenFindUnique.mockResolvedValue(null);
    paymentFindFirst.mockResolvedValue({ id: "pay_1" });
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-1" });
    expect(result).toMatchObject({ valid: false, reason: "ref_consumed" });
  });

  it("rejects a charge that did not succeed", async () => {
    tokenFindUnique.mockResolvedValue(null);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      paystackResponse({ data: { status: "abandoned", amount: 500_000 } }),
    );
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-2" });
    expect(result).toMatchObject({ valid: false, reason: "ref_unverified" });
  });

  it("rejects a successful charge below the registration fee", async () => {
    tokenFindUnique.mockResolvedValue(null);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      paystackResponse({ data: { status: "success", amount: 100_000 } }), // ₦1,000
    );
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-3" });
    expect(result).toMatchObject({ valid: false, reason: "ref_underpaid" });
  });

  it("fails closed when Paystack returns a non-200", async () => {
    tokenFindUnique.mockResolvedValue(null);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(paystackResponse({}, false, 502));
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-4" });
    expect(result).toMatchObject({ valid: false, reason: "ref_unverified" });
  });

  it("fails closed when Paystack is unreachable", async () => {
    tokenFindUnique.mockResolvedValue(null);
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-5" });
    expect(result).toMatchObject({ valid: false, reason: "ref_unverified" });
  });

  it("fails closed when PAYSTACK_SECRET_KEY is unset", async () => {
    tokenFindUnique.mockResolvedValue(null);
    delete process.env.PAYSTACK_SECRET_KEY;
    const result = await validateSignupAccess({ token: null, ref: "psk-ref-6" });
    expect(result).toMatchObject({ valid: false, reason: "ref_unverified" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls through from an unmatched token to a valid ref", async () => {
    tokenFindUnique.mockResolvedValueOnce(null); // token lookup misses
    tokenFindUnique.mockResolvedValueOnce(null); // consumption-marker lookup misses
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      paystackResponse({ data: { status: "success", amount: 500_000, currency: "NGN" } }),
    );
    const result = await validateSignupAccess({ token: "bad", ref: "good-ref" });
    expect(result).toMatchObject({ valid: true, source: "ref" });
  });
});

suite("invite signature helpers", () => {
  beforeEach(() => {
    process.env.SIGNUP_INVITE_SIGNING_SECRET = "invite-secret";
  });

  it("round-trips: a signature it produced verifies", () => {
    const params = { email: "Ada@Example.com", name: "Ada", level: "A1", branchId: "b1", sessionSlot: "morning" };
    const sig = signInviteParams(params);
    expect(sig).toBeTruthy();
    expect(verifyInviteSig(params, sig)).toBe(true);
  });

  it("email is compared case-insensitively", () => {
    const sig = signInviteParams({ email: "ada@example.com", name: "Ada" });
    expect(verifyInviteSig({ email: "ADA@EXAMPLE.COM", name: "Ada" }, sig)).toBe(true);
  });

  it("a tampered param no longer verifies", () => {
    const sig = signInviteParams({ email: "ada@example.com", name: "Ada", level: "A1" });
    expect(verifyInviteSig({ email: "ada@example.com", name: "Ada", level: "C1" }, sig)).toBe(false);
  });

  it("no secret configured → cannot sign, cannot verify", () => {
    delete process.env.SIGNUP_INVITE_SIGNING_SECRET;
    expect(signInviteParams({ email: "a@b.com" })).toBeUndefined();
    expect(verifyInviteSig({ email: "a@b.com" }, "anything")).toBe(false);
  });
});
