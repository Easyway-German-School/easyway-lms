import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingFindUnique: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolSetting: { findUnique: mocks.settingFindUnique },
    tenant: { findUnique: mocks.tenantFindUnique },
  },
}));

import { readCurrentIntake } from "@/lib/intake-server";

describe("readCurrentIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindUnique.mockResolvedValue({ id: "default-school" });
    mocks.settingFindUnique.mockResolvedValue({
      value: { month: "November", year: new Date().getFullYear() },
    });
  });

  it("reads the default school's intake for a legacy account without a tenant id", async () => {
    await expect(readCurrentIntake(null)).resolves.toEqual({
      month: "November",
      year: new Date().getFullYear(),
    });
    expect(mocks.tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: expect.any(String) },
      select: { id: true },
    });
    expect(mocks.settingFindUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "default-school", key: "intake.current" } },
    });
  });
});
