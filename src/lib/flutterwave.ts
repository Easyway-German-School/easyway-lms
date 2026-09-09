import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/safe-json";
import { sendEmail } from "@/lib/mailer";
import { classifyPaymentTransaction, isReceivedPayment, RECEIVED_PAYMENT_STATUSES } from "@/lib/payment";
import { enrollIfPathwayExists } from "@/lib/paystack-verify";
import { promoteIfNextLevelPayment } from "@/lib/promotion";
import { reconcileTravelPackageStudent } from "@/lib/travel-package";
import { KIND, notifyInBackground } from "@/lib/notify";
import { emitWebhook } from "@/lib/webhooks";
import { setTenantScope } from "@/lib/tenant/context";

/**
 * FLUTTERWAVE — the international-card option alongside Paystack.
 *
 * Paystack stays the default and is untouched. This is a parallel path for a
 * student paying with a non-Nigerian Visa/Mastercard: the amount is still the
 * same naira figure (Flutterwave charges the card in NGN and does its own FX),
 * `Payment.currency` stays "NGN", and `method` is "flutterwave" so the office
 * can tell the two apart. Nothing in pricing, invoices or revenue reporting
 * changes.
 *
 * The shape of this file deliberately mirrors `src/lib/paystack-verify.ts`:
 *   initialize → open a hosted checkout
 *   verify     → ask Flutterwave whether a charge is real, then persist
 *   signature  → guard the webhook
 *   persist    → write the invoice / payment / enrolment (same rules as Paystack)
 *
 * Flutterwave differences that bit us elsewhere if forgotten:
 *   - amounts are in MAJOR units (naira), NOT kobo — no divide-by-100.
 *   - the webhook is authenticated by a STATIC hash in the `verif-hash` header
 *     (`FLW_SECRET_HASH`), not an HMAC of the body.
 *   - verify is keyed on Flutterwave's numeric transaction id, which arrives on
 *     the redirect (`?transaction_id=`) and in the webhook (`data.id`), NOT on
 *     our own `tx_ref`. We still store `tx_ref` as the idempotency key.
 */

const FLW_BASE = "https://api.flutterwave.com/v3";

export function flutterwaveConfigured(): boolean {
  return Boolean(process.env.FLW_SECRET_KEY);
}

/**
 * Flutterwave, like Paystack, rejects reserved TLDs (.test, .local). Seeded dev
 * accounts use them, so substitute a routable address in development and refuse
 * outright in production.
 */
export function flutterwaveEmail(email: string): string | null {
  const value = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const reserved = /\.(test|local|localhost|example|invalid)$/i.test(value);
  if (!reserved) return value;
  return process.env.NODE_ENV !== "production" ? "student@example.com" : null;
}

/**
 * Webhook auth. Flutterwave sends the exact string configured as the webhook
 * "secret hash" in the `verif-hash` header — a shared secret, compared whole.
 */
export function isValidFlutterwaveSignature(headerHash: string | null): boolean {
  const secret = process.env.FLW_SECRET_HASH;
  if (!secret || !headerHash) return false;
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(headerHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type FlutterwaveInitInput = {
  email: string;
  name?: string | null;
  /** Naira. Charged to the card as-is; Flutterwave handles any FX. */
  amountNaira: number;
  /** Our idempotency key. Stored in `Payment.stripeSessionId`, same as Paystack. */
  txRef: string;
  redirectUrl: string;
  title: string;
  description: string;
  meta: Record<string, string>;
};

/**
 * Opens a hosted Flutterwave checkout and returns the URL to send the student
 * to. Throws on any non-success so the route can fall back to a friendly error.
 */
export async function initializeFlutterwaveCheckout(
  input: FlutterwaveInitInput,
): Promise<{ link: string; txRef: string }> {
  const secretKey = process.env.FLW_SECRET_KEY;
  if (!secretKey) {
    throw new Error("FLW_SECRET_KEY is not set");
  }

  const response = await fetch(`${FLW_BASE}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: input.txRef,
      amount: input.amountNaira,
      currency: "NGN",
      redirect_url: input.redirectUrl,
      customer: {
        email: input.email,
        name: input.name || undefined,
      },
      customizations: {
        title: input.title,
        description: input.description,
      },
      meta: input.meta,
    }),
  });

  const data = await safeJson<{ status?: string; message?: string; data?: { link?: string } }>(response);
  if (!response.ok || data?.status !== "success" || !data?.data?.link) {
    throw new Error(data?.message || "Flutterwave initialization failed");
  }

  return { link: data.data.link, txRef: input.txRef };
}

export type FlutterwaveTransaction = {
  id: number;
  tx_ref: string;
  flw_ref?: string;
  amount: number;
  currency: string;
  charged_amount?: number;
  status: string;
  customer?: { email?: string; name?: string; phone_number?: string };
  meta?: Record<string, unknown> | null;
};

export type FlutterwaveVerifyResult = {
  /** We reached Flutterwave and it answered. Says nothing about the charge. */
  success: boolean;
  status?: number;
  data?: FlutterwaveTransaction;
  error?: string;
  /**
   * Flutterwave confirmed the charge but we could not write it down. Kept
   * separate from a verify failure — the student has paid, so "try again" is
   * the wrong thing to tell them. Same distinction the Paystack path makes.
   */
  persistFailed?: boolean;
};

/**
 * Verify one Flutterwave transaction by its numeric id and, on success, persist
 * the invoice / payment / enrolment. Safe to call from a route handler or a
 * server component — no HTTP round-trip back into our own app.
 *
 * `expectedNaira` guards against a tampered redirect: Flutterwave's own figure
 * must be at least what we meant to charge, in NGN.
 */
export async function verifyFlutterwaveTransaction(
  transactionId: string | number,
  opts: { expectedNaira?: number } = {},
): Promise<FlutterwaveVerifyResult> {
  const id = String(transactionId || "").trim();
  if (!id) return { success: false, status: 400, error: "Missing transaction id" };

  const secretKey = process.env.FLW_SECRET_KEY;
  if (!secretKey) {
    console.error("Flutterwave verify blocked: FLW_SECRET_KEY is not set");
    return { success: false, status: 503, error: "Payment checking is temporarily unavailable." };
  }

  let data: { status?: string; message?: string; data?: FlutterwaveTransaction } | null;
  try {
    const response = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(id)}/verify`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    data = await safeJson(response);
    if (!response.ok || data?.status !== "success" || !data?.data) {
      return {
        success: false,
        status: 502,
        error: data?.message || "Flutterwave verification failed",
        data: data?.data,
      };
    }
  } catch (error) {
    console.error("Flutterwave verify: could not reach Flutterwave", { id, error });
    return { success: false, status: 502, error: "Could not reach Flutterwave to verify this payment" };
  }

  const transaction = data.data;

  const chargeOk =
    transaction.status?.toLowerCase() === "successful" &&
    String(transaction.currency || "").toUpperCase() === "NGN" &&
    (opts.expectedNaira === undefined || Number(transaction.amount) >= opts.expectedNaira - 1);

  if (chargeOk) {
    const meta = normalizeMeta(transaction.meta);
    const amountNaira = Math.round(Number(transaction.amount) || 0);
    try {
      // Exam fees are settled by the caller via `settleExamFee` — not here.
      if (meta.kind === "private_class_upgrade") {
        await persistFlutterwavePrivateUpgrade({ reference: transaction.tx_ref, amountNaira, metadata: meta });
      } else if (meta.kind !== "exam_fee") {
        await persistFlutterwaveCharge({
          reference: transaction.tx_ref,
          amountNaira,
          currency: "NGN",
          metadata: meta,
        });
      }
    } catch (error) {
      console.error("Flutterwave verify: charge confirmed but could not be recorded", { id, error });
      return {
        success: true,
        status: 200,
        data: transaction,
        persistFailed: true,
        error: "Your payment went through, but we could not update your account automatically.",
      };
    }
  }

  return { success: true, status: 200, data: transaction };
}

/** Flutterwave nests `meta` under different keys across API versions. Flatten it. */
export function normalizeMeta(meta: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const source = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

function paymentDescription(paymentType: string, pathwayName: string) {
  if (paymentType === "registration") return `Registration fee for ${pathwayName}`;
  if (paymentType === "deposit") return `Deposit payment for ${pathwayName}`;
  return `Full payment for ${pathwayName}`;
}

export type PersistFlutterwaveInput = {
  /** `tx_ref` — the idempotency key, stored in `Payment.stripeSessionId`. */
  reference: string;
  /** Naira (major units). Flutterwave does not use kobo. */
  amountNaira: number;
  currency: string;
  metadata: Record<string, string>;
  /**
   * Off for the redirect path, which only confirms for the student — the
   * webhook owns the notifications so a student who does AND does not make it
   * back to the callback page is told exactly once. `notifyInBackground` is not
   * idempotent; the Payment row is (deduped on `reference`), so notifications
   * only ever fire on the branch that actually creates the row.
   */
  notify?: boolean;
};

/**
 * Write down a settled Flutterwave tuition / next-level payment.
 *
 * This mirrors the tuition branch of the Paystack webhook
 * (`src/app/api/paystack/webhook/route.ts`) — same invoice/payment rules, same
 * `partial`-on-deposit status, same FIFO-friendly single-invoice-per-balance
 * handling, same promotion and Travel Package reconcile hooks. Kept as its own
 * function rather than shared with the Paystack path so this change cannot
 * alter how a Paystack payment is recorded.
 *
 * Idempotent on `reference`: Flutterwave's webhook and the browser redirect can
 * both land, and the second one early-returns.
 */
export async function persistFlutterwaveCharge(input: PersistFlutterwaveInput): Promise<{
  recorded: boolean;
  alreadyRecorded: boolean;
  studentId: string | null;
}> {
  const metadata = input.metadata || {};
  const reference = String(input.reference || "");
  const paymentAmount = Math.max(0, Math.round(Number(input.amountNaira) || 0));
  const currency = input.currency || "NGN";

  const rawStudentId = String(metadata.studentId || metadata.userId || "");
  const pathwayId = String(metadata.pathwayId || "");
  const pathwayName = metadata.pathwayName || "program";
  const tuitionFeeValue = Math.max(0, Math.round(Number(metadata.tuitionFee || 0)));
  const derivedTotal = Math.round(Number(metadata.totalAmount || 0));
  const totalAmount = tuitionFeeValue > 0 ? Math.max(tuitionFeeValue, derivedTotal) : derivedTotal;
  const paymentStage = String(metadata.paymentStage || metadata.paymentType || "full");
  const paymentType =
    paymentStage === "registration" ? "registration" : paymentStage === "full" ? "full" : "deposit";
  const depositPercent = Number(metadata.depositPercent || 100);
  const forNextLevel = String(metadata.forNextLevel || "") === "true";

  if (!rawStudentId || !reference || paymentAmount <= 0) {
    console.error("Flutterwave persist skipped: invalid metadata", { rawStudentId, reference, paymentAmount });
    return { recorded: false, alreadyRecorded: false, studentId: null };
  }

  const classification = classifyPaymentTransaction({
    paymentAmount: forNextLevel ? Math.min(paymentAmount, tuitionFeeValue || paymentAmount) : paymentAmount,
    totalAmount,
    tuitionFee: tuitionFeeValue,
    depositPercent,
    paymentStage,
    paymentType,
  });
  const effectivePaymentType = classification.paymentType;
  const settledStatus = effectivePaymentType === "deposit" ? "partial" : "completed";

  const student =
    (await prisma.student.findUnique({ where: { id: rawStudentId }, include: { user: true } })) ||
    (await prisma.student.findUnique({ where: { userId: rawStudentId }, include: { user: true } }));

  if (!student) {
    console.error("Flutterwave persist: could not resolve student", { rawStudentId });
    return { recorded: false, alreadyRecorded: false, studentId: null };
  }

  // The webhook runs `withUnscoped` (Flutterwave carries no tenant). Pin the
  // scope to the student's school before any write, or the rows land with
  // tenantId = NULL and vanish from every scoped read.
  if (student.tenantId) setTenantScope(student.tenantId);

  const existingPayment = await prisma.payment.findFirst({ where: { stripeSessionId: reference } });

  if (existingPayment) {
    if (isReceivedPayment(existingPayment.status)) {
      return { recorded: false, alreadyRecorded: true, studentId: student.id };
    }
    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        status: settledStatus,
        amount: paymentAmount,
        currency,
        method: "flutterwave",
        description: paymentDescription(effectivePaymentType, pathwayName),
        paymentIntentId: reference,
      },
    });
    if (existingPayment.invoiceId) {
      await prisma.invoice
        .update({ where: { id: existingPayment.invoiceId }, data: { status: classification.invoiceStatus } })
        .catch((error) =>
          console.error(`[flutterwave] payment ${existingPayment.id} recorded, invoice update failed:`, error),
        );
    }
    await enrollIfPathwayExists({ studentId: student.id, pathwayId, reference });
    await promoteIfNextLevelPayment(student.id, metadata).catch((error) =>
      console.error("Flutterwave: next-level promotion failed", { studentId: student.id, error }),
    );
    return { recorded: true, alreadyRecorded: false, studentId: student.id };
  }

  // One invoice per open balance: a top-up toward the same level attaches to the
  // invoice already open rather than spawning a second `partial` the reminder
  // job would chase twice. A next-level payment is a genuinely new balance.
  const openInvoice = forNextLevel
    ? null
    : await prisma.invoice.findFirst({
        where: { studentId: student.id, status: "partial" },
        orderBy: { createdAt: "asc" },
      });

  let invoiceId: string;
  if (openInvoice) {
    const priorPaid = await prisma.payment.aggregate({
      where: { invoiceId: openInvoice.id, status: { in: [...RECEIVED_PAYMENT_STATUSES] } },
      _sum: { amount: true },
    });
    const runningPaid = (priorPaid._sum.amount ?? 0) + paymentAmount;
    await prisma.invoice.update({
      where: { id: openInvoice.id },
      data: { status: runningPaid >= openInvoice.totalAmount ? "paid" : "partial" },
    });
    invoiceId = openInvoice.id;
  } else {
    const invoice = await prisma.invoice.create({
      data: {
        studentId: student.id,
        totalAmount: Math.max(totalAmount || paymentAmount, paymentAmount),
        currency,
        status: classification.invoiceStatus,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lineItems: { pathwayId, pathwayName, paymentType: effectivePaymentType, depositPercent },
      },
    });
    invoiceId = invoice.id;
  }

  const payment = await prisma.payment.create({
    data: {
      studentId: student.id,
      invoiceId,
      amount: paymentAmount,
      currency,
      status: settledStatus,
      method: "flutterwave",
      description: paymentDescription(effectivePaymentType, pathwayName),
      stripeSessionId: reference,
      paymentIntentId: reference,
    },
  });

  await emitWebhook(
    "payment.recorded",
    {
      paymentId: payment.id,
      studentId: student.id,
      studentCode: student.studentCode,
      amount: paymentAmount,
      currency,
      type: effectivePaymentType,
      reference,
    },
    { tenantId: student.tenantId ?? undefined },
  );

  await enrollIfPathwayExists({ studentId: student.id, pathwayId, reference });
  await reconcileTravelPackageStudent({ studentId: student.id, setPathway: false }).catch((error) =>
    console.error("Flutterwave: Travel Package reconcile failed", { studentId: student.id, error }),
  );
  await promoteIfNextLevelPayment(student.id, metadata).catch((error) =>
    console.error("Flutterwave: next-level promotion failed", { studentId: student.id, error }),
  );

  if (input.notify) {
    const message =
      effectivePaymentType === "registration"
        ? `We received your registration fee for ${pathwayName}. Your account is active.`
        : effectivePaymentType === "deposit"
        ? `We received your ${depositPercent}% deposit for ${pathwayName}. Your access is active and the remaining balance is now due.`
        : `Your payment for ${pathwayName} was completed successfully.`;

    notifyInBackground({
      to: { studentIds: [student.id] },
      kind: KIND.paymentReceived,
      severity: "success",
      title: effectivePaymentType === "deposit" ? "Part-payment received" : "Payment received",
      message,
      link: "/payments",
    });

    notifyInBackground({
      to: { audience: "admin", capability: "payments" },
      kind: KIND.paymentReceived,
      severity: "success",
      title: `₦${paymentAmount.toLocaleString()} received (international card)`,
      message: `${student.user?.name || "A student"} paid ₦${paymentAmount.toLocaleString()} (${effectivePaymentType}) for ${pathwayName} via Flutterwave.`,
      link: "/admin/payments",
      push: true,
    });

    if (student.user?.email) {
      await sendEmail({
        to: student.user.email,
        subject:
          effectivePaymentType === "deposit"
            ? "Your deposit payment was received"
            : "Your Easyway payment was received",
        html: `<p>Hello ${student.user.name || "there"},</p><p>${message}</p><p>Thank you,<br/>Easyway LMS</p>`,
      }).catch((error) => console.error("Flutterwave: confirmation email failed", error));
    }

    if (effectivePaymentType === "full" && student.user?.email) {
      try {
        const { welcomeEmailTemplate } = await import("@/lib/email-templates");
        const template = welcomeEmailTemplate(student.user.name || "Student", pathwayName);
        await sendEmail({ to: student.user.email, subject: template.subject, html: template.html });
        await prisma.payment
          .update({ where: { id: payment.id }, data: { welcomeEmailSentAt: new Date() } })
          .catch(() => null);
      } catch (error) {
        console.error("Flutterwave: welcome email failed", error);
      }
    }
  }

  return { recorded: true, alreadyRecorded: false, studentId: student.id };
}

/**
 * A student upgrading to one-to-one tuition through Flutterwave. Mirrors the
 * `private_class_upgrade` branch of the Paystack webhook: its own `completed`
 * Payment, and it flips `Student.classType` to "private" so the tutor-assignment
 * queue picks the student up. Idempotent on `reference`.
 */
export async function persistFlutterwavePrivateUpgrade(input: {
  reference: string;
  amountNaira: number;
  metadata: Record<string, string>;
}): Promise<{ recorded: boolean; alreadyRecorded: boolean; studentId: string | null }> {
  const reference = String(input.reference || "");
  const amount = Math.max(0, Math.round(Number(input.amountNaira) || 0));
  const studentId = String(input.metadata.studentId || "");

  if (!reference || !studentId || amount <= 0) {
    console.error("Flutterwave private-upgrade persist skipped: invalid metadata", { reference, studentId, amount });
    return { recorded: false, alreadyRecorded: false, studentId: null };
  }

  const existing = await prisma.payment.findFirst({ where: { stripeSessionId: reference } });
  if (existing) {
    return { recorded: false, alreadyRecorded: true, studentId };
  }

  const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } });
  if (!student) {
    console.error("Flutterwave private-upgrade: could not resolve student", { studentId });
    return { recorded: false, alreadyRecorded: false, studentId: null };
  }
  if (student.tenantId) setTenantScope(student.tenantId);

  await prisma.payment.create({
    data: {
      studentId: student.id,
      amount,
      currency: "NGN",
      status: "completed",
      method: "flutterwave",
      description: "Private (one-to-one) class upgrade",
      stripeSessionId: reference,
      paymentIntentId: reference,
    },
  });

  await prisma.student.update({ where: { id: student.id }, data: { classType: "private" } });

  notifyInBackground({
    to: { studentIds: [student.id] },
    kind: KIND.paymentReceived,
    severity: "success",
    title: "Private classes unlocked",
    message: "Your one-to-one upgrade payment was received. The office will assign your tutor shortly.",
    link: "/dashboard",
  });
  notifyInBackground({
    to: { audience: "admin", capability: "students" },
    kind: KIND.paymentReceived,
    severity: "success",
    title: "Private class upgrade purchased (international card)",
    message: `${student.user?.name || "A student"} paid ₦${amount.toLocaleString()} via Flutterwave to switch to private classes. Assign a tutor.`,
    link: "/admin/lecturer-invite",
    push: true,
  });

  if (student.user?.email) {
    await sendEmail({
      to: student.user.email,
      subject: "Your private class upgrade was received",
      html: `<p>Hello ${student.user.name || "there"},</p><p>We received your payment for one-to-one private tuition. Our office will assign a dedicated tutor and confirm your schedule shortly.</p><p>Thank you,<br/>Easyway LMS</p>`,
    }).catch((error) => console.error("Flutterwave private-upgrade: email failed", error));
  }

  return { recorded: true, alreadyRecorded: false, studentId: student.id };
}
