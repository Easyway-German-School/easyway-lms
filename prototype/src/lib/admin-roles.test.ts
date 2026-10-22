import { describe, expect, it } from "vitest";
import { capabilitiesFor, normalizeAdminRole, ADMIN_ROLE_LABELS } from "@/lib/admin-roles";

describe("partner admin role aliases", () => {
  it.each(["partner", "ambassador", "Easyway Ambassador", "Partner / Ambassador", "Influencer / Affiliate Partner"])(
    "maps %s to the restricted influencer role",
    (label) => {
      expect(normalizeAdminRole(label)).toBe("influencer");
      expect(capabilitiesFor(label)).toEqual(["influencer"]);
    },
  );

  it("uses the partner-facing role label", () => {
    expect(ADMIN_ROLE_LABELS.influencer).toBe("Partner / Ambassador");
  });
});
