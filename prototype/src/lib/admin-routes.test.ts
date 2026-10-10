import { describe, expect, it } from "vitest";

import { capabilityForAdminPath } from "@/lib/admin-routes";

describe("capabilityForAdminPath", () => {
  it("places referrals under the billing capability", () => {
    expect(capabilityForAdminPath("/admin/referrals")).toBe("payments");
  });
});
