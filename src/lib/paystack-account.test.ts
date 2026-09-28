import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whose Paystack account a payment goes through. The rule that matters most is
 * the third one: a tenant with no account of its own gets NONE — never the
 * platform's. If that ever regressed, a second business's students would pay into
 * EasyWay's account.
 */

const PLATFORM = "t_platform";
const OTHER = "t_other";

const settings = new Map<string, { id: string; value: unknown }>();
const settingKey = (tenantId: string, key: string) => `${tenantId}::${key}`;

vi.mock("@/lib/prisma", () => ({
  guardedPrisma: {
    tenant: {
      findUnique: vi.fn(async () => ({ id: "t_platform" })),
    },
    schoolSetting: {
      findFirst: vi.fn(async ({ where }: { where: { tenantId: string; key: string } }) => {
        const row = settings.get(settingKey(where.tenantId, where.key));
        return row ? { id: row.id, value: row.value } : null;
      }),
      create: vi.fn(async ({ data }: { data: { tenantId: string; key: string; value: unknown } }) => {
        settings.set(settingKey(data.tenantId, data.key), { id: "row_1", value: data.value });
        return {};
      }),
      update: vi.fn(async ({ data }: { where: { id: string }; data: { value: unknown } }) => {
        for (const [k, v] of settings) if (v.id === "row_1") settings.set(k, { id: "row_1", value: data.value });
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tenantId: string; key: string } }) => {
        settings.delete(settingKey(where.tenantId, where.key));
        return { count: 1 };
      }),
    },
  },
}));

vi.mock("@/lib/tenant/context", () => ({ currentTenantId: vi.fn(() => null) }));

// A reversible stand-in for the real AES box; what matters here is that the
// stored value is NOT the plaintext key.
vi.mock("@/lib/mfa", () => ({
  encryptSecret: (plain: string) => `enc(${plain.split("").reverse().join("")})`,
  decryptSecret: (stored: string) => {
    const m = /^enc\((.*)\)$/.exec(stored);
    return m ? m[1].split("").reverse().join("") : null;
  },
}));

const guardedFetch = vi.fn();
vi.mock("@/lib/guarded-fetch", () => ({ guardedFetch: (...args: unknown[]) => guardedFetch(...args) }));

import {
  checkKeyWithPaystack,
  describeOwnAccount,
  forgetPaystackAccount,
  paystackAccountFor,
  parseSecretKey,
  removeOwnAccount,
  saveOwnAccount,
  PAYSTACK_ACCOUNT_KEY,
} from "@/lib/paystack-account";

const OLD_ENV = { ...process.env };
const OWN_KEY = "sk_live_abcdefghijklmnop1234";

beforeEach(() => {
  settings.clear();
  forgetPaystackAccount();
  guardedFetch.mockReset();
  process.env = { ...OLD_ENV, PAYSTACK_SECRET_KEY: "sk_live_PLATFORMKEY0000000000" };
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("parseSecretKey", () => {
  it("accepts live and test secret keys", () => {
    expect(parseSecretKey(OWN_KEY)).toEqual({ ok: true, key: OWN_KEY, mode: "live" });
    expect(parseSecretKey("  sk_test_abcdefghijklmnop1234 ")).toMatchObject({ ok: true, mode: "test" });
  });

  it("rejects public keys, short keys and junk", () => {
    expect(parseSecretKey("pk_live_abcdefghijklmnop1234").ok).toBe(false);
    expect(parseSecretKey("sk_live_short").ok).toBe(false);
    expect(parseSecretKey("hello").ok).toBe(false);
    expect(parseSecretKey(undefined).ok).toBe(false);
  });
});

describe("paystackAccountFor — whose key is used", () => {
  it("uses the environment key when there is no tenant context (scripts, jobs)", async () => {
    expect(await paystackAccountFor(null)).toEqual({ secretKey: "sk_live_PLATFORMKEY0000000000", source: "platform" });
  });

  it("gives the platform tenant (EasyWay) the environment key, unchanged", async () => {
    expect(await paystackAccountFor(PLATFORM)).toEqual({
      secretKey: "sk_live_PLATFORMKEY0000000000",
      source: "platform",
    });
  });

  it("uses a tenant's own key once it has connected one", async () => {
    await saveOwnAccount(OTHER, OWN_KEY, "live");
    expect(await paystackAccountFor(OTHER)).toEqual({ secretKey: OWN_KEY, source: "own" });
  });

  it("FAILS CLOSED: a tenant with no account of its own gets none, never the platform's", async () => {
    expect(await paystackAccountFor(OTHER)).toBeNull();
  });

  it("stops using a tenant's key the moment it disconnects, and does not fall back to the platform's", async () => {
    await saveOwnAccount(OTHER, OWN_KEY, "live");
    expect((await paystackAccountFor(OTHER))?.source).toBe("own");
    await removeOwnAccount(OTHER);
    expect(await paystackAccountFor(OTHER)).toBeNull();
  });

  it("treats an undecryptable stored key as no account (and not as the platform's)", async () => {
    settings.set(settingKey(OTHER, PAYSTACK_ACCOUNT_KEY), {
      id: "row_x",
      value: { secretKeyEnc: "garbage", last4: "1234", mode: "live", enabled: true, connectedAt: "" },
    });
    expect(await paystackAccountFor(OTHER)).toBeNull();
  });

  it("ignores a disabled stored account", async () => {
    settings.set(settingKey(OTHER, PAYSTACK_ACCOUNT_KEY), {
      id: "row_x",
      value: { secretKeyEnc: "enc(4321)", last4: "1234", mode: "live", enabled: false, connectedAt: "" },
    });
    expect(await paystackAccountFor(OTHER)).toBeNull();
  });

  it("returns nothing for a tenant when neither an own key nor an env key exists", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(await paystackAccountFor(PLATFORM)).toBeNull();
    expect(await paystackAccountFor(null)).toBeNull();
  });
});

describe("saving and describing an account", () => {
  it("never stores the plaintext key", async () => {
    await saveOwnAccount(OTHER, OWN_KEY, "live");
    const stored = JSON.stringify(settings.get(settingKey(OTHER, PAYSTACK_ACCOUNT_KEY))?.value);
    expect(stored).not.toContain(OWN_KEY);
    expect(stored).toContain("secretKeyEnc");
  });

  it("describes a connected account by its last four characters only", async () => {
    await saveOwnAccount(OTHER, OWN_KEY, "live");
    const described = await describeOwnAccount(OTHER);
    expect(described).toMatchObject({ connected: true, last4: "1234", mode: "live" });
    expect(JSON.stringify(described)).not.toContain(OWN_KEY);
  });

  it("says when a school is on the platform's account, and when it has none", async () => {
    expect(await describeOwnAccount(PLATFORM)).toEqual({ connected: false, usingPlatformAccount: true });
    expect(await describeOwnAccount(OTHER)).toEqual({ connected: false, usingPlatformAccount: false });
  });
});

describe("checkKeyWithPaystack", () => {
  it("accepts a key Paystack answers 200 to", async () => {
    guardedFetch.mockResolvedValue({ ok: true, status: 200 });
    expect(await checkKeyWithPaystack(OWN_KEY)).toEqual({ ok: true });
  });

  it("rejects a key Paystack answers 401 to", async () => {
    guardedFetch.mockResolvedValue({ ok: false, status: 401 });
    expect(await checkKeyWithPaystack(OWN_KEY)).toMatchObject({ ok: false });
  });

  it("does not save anything on a network failure", async () => {
    guardedFetch.mockRejectedValue(new Error("offline"));
    expect(await checkKeyWithPaystack(OWN_KEY)).toMatchObject({ ok: false });
  });
});
