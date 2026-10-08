import { describe, expect, it, vi } from "vitest";
import { resolveSignupReferralAttribution } from "./referral-attribution";

describe("resolveSignupReferralAttribution", () => {
  it("keeps a valid shared referral link attributed", async () => {
    const findReferrer = vi.fn().mockResolvedValue({ id: "student-1" });

    await expect(resolveSignupReferralAttribution(" ewabc123 ", true, findReferrer)).resolves.toEqual({
      referralCode: "EWABC123",
      referrerStudentId: "student-1",
    });
    expect(findReferrer).toHaveBeenCalledWith("EWABC123");
  });

  it("continues without attribution when there is no referral link", async () => {
    const findReferrer = vi.fn();

    await expect(resolveSignupReferralAttribution(undefined, true, findReferrer)).resolves.toBeNull();
    expect(findReferrer).not.toHaveBeenCalled();
  });

  it("continues without attribution when a shared link no longer resolves", async () => {
    const findReferrer = vi.fn().mockResolvedValue(null);

    await expect(resolveSignupReferralAttribution("EWUNKNOWN", true, findReferrer)).resolves.toBeNull();
  });

  it("does not block returning students or a temporary lookup failure", async () => {
    const findReferrer = vi.fn().mockRejectedValue(new Error("lookup unavailable"));
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveSignupReferralAttribution("EWABC123", false, findReferrer)).resolves.toBeNull();
    expect(findReferrer).not.toHaveBeenCalled();

    await expect(resolveSignupReferralAttribution("EWABC123", true, findReferrer)).resolves.toBeNull();
    expect(logError).toHaveBeenCalledOnce();
    logError.mockRestore();
  });
});
