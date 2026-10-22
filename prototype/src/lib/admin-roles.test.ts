import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLE_LABELS,
  canReceiveAdminNotification,
  capabilitiesFor,
  normalizeAdminRole,
} from "@/lib/admin-roles";

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

  it("keeps generic admin notifications away from partner accounts", () => {
    expect(canReceiveAdminNotification("Partner / Ambassador")).toBe(false);
    expect(canReceiveAdminNotification("Partner / Ambassador", "payments")).toBe(false);
    expect(canReceiveAdminNotification("Partner / Ambassador", "influencer")).toBe(true);
    expect(canReceiveAdminNotification("super")).toBe(true);
  });
});
