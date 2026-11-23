import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUser, comparePassword, checkRateLimit } = vi.hoisted(() => ({
  findUser: vi.fn(),
  comparePassword: vi.fn(),
  checkRateLimit: vi.fn(() => ({ ok: true, retryAfter: 0, remaining: 1 })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUser },
    lecturer: { findUnique: vi.fn() },
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: comparePassword },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  clearRateLimit: vi.fn(),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/tenant/context", () => ({
  beginRequestScope: vi.fn(),
  runUnscoped: (_reason: string, callback: () => Promise<unknown>) => callback(),
  runWithTenant: (_tenantId: string, callback: () => Promise<unknown>) => callback(),
  setTenantScope: vi.fn(),
}));

vi.mock("@/lib/mfa", () => ({
  verifyLogin: vi.fn().mockResolvedValue({ status: "not_enrolled" }),
  shouldRequireMfa: vi.fn().mockReturnValue(false),
  isEnforced: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/sign-in-audit", () => ({
  recordStaffSignIn: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => vi.fn()),
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => options,
}));

import { authOptions } from "./auth";

const authorize = (authOptions.providers[0] as unknown as {
  authorize: (credentials: { email: string; password: string }, req: { headers: Record<string, string> }) => Promise<unknown>;
}).authorize;

describe("credentials sign-in", () => {
  beforeEach(() => {
    findUser.mockReset();
    comparePassword.mockReset();
    findUser.mockResolvedValue({
      id: "user_1",
      email: "student@example.com",
      name: "Student",
      password: "stored-hash",
      role: "STUDENT",
      tenantId: "tenant_1",
      adminRole: null,
      adminCapabilities: [],
    });
    comparePassword.mockResolvedValue(true);
  });

  it("looks up the account using a trimmed, lowercase email", async () => {
    await authorize(
      { email: "  Student@Example.COM ", password: "correct-password" },
      { headers: {} } as never,
    );

    expect(findUser).toHaveBeenCalledWith({
      where: { email: "student@example.com" },
    });
    expect(comparePassword).toHaveBeenCalledWith("correct-password", "stored-hash");
  });

  it("does not spend the shared school IP allowance on a correct password", async () => {
    checkRateLimit.mockClear();
    await authorize(
      { email: "student@example.com", password: "correct-password" },
      { headers: {} } as never,
    );
    const keys = checkRateLimit.mock.calls.map((call) => String(call[0]));
    expect(keys).toContain("signin:email:student@example.com");
    expect(keys.some((key) => key.startsWith("signin:ip:"))).toBe(false);
  });

  it("counts a wrong password against the shared IP, and still says invalid credentials", async () => {
    comparePassword.mockResolvedValue(false);
    checkRateLimit.mockClear();
    await expect(
      authorize(
        { email: "student@example.com", password: "wrong-password" },
        { headers: {} } as never,
      ),
    ).rejects.toThrow("Invalid credentials");
    const keys = checkRateLimit.mock.calls.map((call) => String(call[0]));
    expect(keys.some((key) => key.startsWith("signin:ip:"))).toBe(true);
  });
});
