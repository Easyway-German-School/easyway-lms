import { describe, expect, it, vi } from "vitest";
import { resolveSignupPromoAttribution } from "./promo-attribution";

const feeLookup = { level: "A1", branch: null, classType: "group", pathway: null };

describe("resolveSignupPromoAttribution", () => {
  it("freezes a discount for a valid active code", async () => {
    const findCode = vi.fn().mockResolvedValue({
      id: "code-1",
      type: "influencer",
      discountPercent: 10,
      discountFlat: null,
      discountCapAmount: null,
    });

    const result = await resolveSignupPromoAttribution(" testinf01 ", true, findCode, feeLookup);
    expect(findCode).toHaveBeenCalledWith("TESTINF01");
    expect(result).toEqual({
      promoCodeId: "code-1",
      codeSnapshot: "TESTINF01",
      type: "influencer",
      discountAmount: expect.any(Number),
    });
  });

  it("continues without attribution when there is no code", async () => {
    const findCode = vi.fn();
    await expect(resolveSignupPromoAttribution(undefined, true, findCode, feeLookup)).resolves.toBeNull();
    expect(findCode).not.toHaveBeenCalled();
  });

  it("continues without attribution when a code no longer resolves", async () => {
    const findCode = vi.fn().mockResolvedValue(null);
    await expect(resolveSignupPromoAttribution("UNKNOWN", true, findCode, feeLookup)).resolves.toBeNull();
  });

  it("does not block returning students or a temporary lookup failure", async () => {
    const findCode = vi.fn().mockRejectedValue(new Error("lookup unavailable"));
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveSignupPromoAttribution("CODE1", false, findCode, feeLookup)).resolves.toBeNull();
    expect(findCode).not.toHaveBeenCalled();

    await expect(resolveSignupPromoAttribution("CODE1", true, findCode, feeLookup)).resolves.toBeNull();
    expect(logError).toHaveBeenCalledOnce();
    logError.mockRestore();
  });
});
