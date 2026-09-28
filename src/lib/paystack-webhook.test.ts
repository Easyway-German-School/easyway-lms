import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tenant webhook is the one place a business's own Paystack account talks to
 * us, and a business controls what that account sends. These tests pin the three
 * things that must never happen: accepting a tenant webhook under the platform's
 * key, minting platform credit from a business's own account, and settling a
 * payment for someone else's student.
 */

const account = vi.fn();
vi.mock("@/lib/paystack-account", () => ({ paystackAccountFor: (...a: unknown[]) => account(...a) }));

const creditTenant = vi.fn();
vi.mock("@/lib/usage/record", () => ({ creditTenant: (...a: unknown[]) => creditTenant(...a) }));

const notify = vi.fn();
vi.mock("@/lib/notify", () => ({
  KIND: { gatewayError: "gateway_error", paymentReceived: "payment_received" },
  notifyInBackground: (...a: unknown[]) => notify(...a),
}));

const setTenantScope = vi.fn();
vi.mock("@/lib/tenant/context", () => ({ setTenantScope: (...a: unknown[]) => setTenantScope(...a) }));

const studentFindUnique = vi.fn();
const paymentCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findUnique: (...a: unknown[]) => studentFindUnique(...a), update: vi.fn() },
    payment: { findFirst: vi.fn(async () => null), create: (...a: unknown[]) => paymentCreate(...a), update: vi.fn() },
    invoice: { create: vi.fn(async () => ({ id: "inv" })), update: vi.fn() },
    notification: { create: vi.fn(async () => ({ title: "t", message: "m" })) },
    emailLog: { create: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/payment", () => ({
  classifyPaymentTransaction: () => ({ paymentType: "full", invoiceStatus: "paid" }),
  isReceivedPayment: () => false,
}));
vi.mock("@/lib/exam-payments", () => ({ settleExamFee: vi.fn() }));
vi.mock("@/lib/paystack-verify", () => ({ enrollIfPathwayExists: vi.fn() }));
vi.mock("@/lib/promotion", () => ({ promoteIfNextLevelPayment: vi.fn(async () => undefined) }));
vi.mock("@/lib/enrolment-letter-trigger", () => ({ notifyEnrolmentLetterIfSettled: vi.fn() }));
vi.mock("@/lib/webhooks", () => ({ emitWebhook: vi.fn() }));

import { processPaystackWebhook } from "@/lib/paystack-webhook";

const TENANT = "t_school";
const OWN = "sk_live_OWNKEYOWNKEYOWNKEY";
const PLATFORM = "sk_live_PLATFORMPLATFORM";

function request(payload: unknown, signKey: string | null) {
  const body = JSON.stringify(payload);
  const headers = new Headers();
  if (signKey) headers.set("x-paystack-signature", crypto.createHmac("sha512", signKey).update(body, "utf8").digest("hex"));
  return new Request("http://localhost/api/paystack/webhook/x", { method: "POST", body, headers });
}

const charge = (metadata: Record<string, unknown>) => ({
  event: "charge.success",
  data: { reference: "ref_1", amount: 5_000_000, metadata },
});

beforeEach(() => {
  for (const m of [account, creditTenant, notify, setTenantScope, studentFindUnique, paymentCreate]) m.mockReset();
  studentFindUnique.mockResolvedValue(null);
});

describe("tenant webhook — which key it accepts", () => {
  it("accepts a payload signed with the tenant's OWN key", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    const res = await processPaystackWebhook(request({ event: "transfer.success" }, OWN), { tenantId: TENANT });
    expect(res.status).toBe(200);
    expect(setTenantScope).toHaveBeenCalledWith(TENANT);
  });

  it("rejects a payload signed with the PLATFORM key, even if the tenant has no account", async () => {
    account.mockResolvedValue({ secretKey: PLATFORM, source: "platform" });
    const res = await processPaystackWebhook(request(charge({}), PLATFORM), { tenantId: TENANT });
    expect(res.status).toBe(401);
  });

  it("rejects a payload signed with the wrong key, and warns THAT tenant's admins, not the platform's", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    const res = await processPaystackWebhook(request(charge({}), "sk_live_SOMEONEELSE00000"), { tenantId: TENANT });
    expect(res.status).toBe(401);
    expect(setTenantScope).toHaveBeenCalledWith(TENANT);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ link: "/admin/settings/payments" });
  });

  it("rejects an unsigned payload", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    const res = await processPaystackWebhook(request(charge({}), null), { tenantId: TENANT });
    expect(res.status).toBe(401);
  });
});

describe("tenant webhook — a business controls what its own account sends", () => {
  it("IGNORES a platform_topup, so a business cannot mint platform credit by paying itself", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    const res = await processPaystackWebhook(
      request(charge({ kind: "platform_topup", tenantId: TENANT }), OWN),
      { tenantId: TENANT },
    );
    expect(res.status).toBe(200);
    expect(creditTenant).not.toHaveBeenCalled();
  });

  it("refuses to settle a payment for a student who belongs to another tenant", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    studentFindUnique.mockResolvedValue({ id: "stu_1", tenantId: "t_someone_else", user: null });
    const res = await processPaystackWebhook(request(charge({ studentId: "stu_1" }), OWN), { tenantId: TENANT });
    expect(res.status).toBe(200);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("does record a payment for the tenant's own student", async () => {
    account.mockResolvedValue({ secretKey: OWN, source: "own" });
    studentFindUnique.mockResolvedValue({ id: "stu_1", tenantId: TENANT, studentCode: "S1", user: null });
    paymentCreate.mockResolvedValue({ id: "pay_1" });
    const res = await processPaystackWebhook(request(charge({ studentId: "stu_1" }), OWN), { tenantId: TENANT });
    expect(res.status).toBe(200);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
  });
});

describe("platform webhook — unchanged behaviour", () => {
  it("still honours a platform_topup signed with the platform key", async () => {
    account.mockResolvedValue({ secretKey: PLATFORM, source: "platform" });
    creditTenant.mockResolvedValue({ applied: true, balanceKobo: BigInt(1) });
    const res = await processPaystackWebhook(request(charge({ kind: "platform_topup", tenantId: TENANT }), PLATFORM));
    expect(res.status).toBe(200);
    expect(creditTenant).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload not signed with the platform key", async () => {
    account.mockResolvedValue({ secretKey: PLATFORM, source: "platform" });
    const res = await processPaystackWebhook(request(charge({}), OWN));
    expect(res.status).toBe(401);
  });
});
