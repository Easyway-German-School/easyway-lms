import { prisma } from "@/lib/prisma";
import { classifyPaymentTransaction, isReceivedPayment } from "@/lib/payment";
import { promoteIfNextLevelPayment } from "@/lib/promotion";
import { safeJson } from "@/lib/safe-json";

function getPaymentDescription(paymentType: string, pathwayName: string) {
  if (paymentType === "registration") {
    return `Registration fee for ${pathwayName}`;
  }

  if (paymentType === "deposit") {
    return `Deposit payment for ${pathwayName}`;
  }

  return `Full payment for ${pathwayName}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveStudentId(metadata: any): Promise<string | null> {
  const studentIdValue = String(metadata.studentId || "");
  if (studentIdValue) {
    const student = await prisma.student.findUnique({ where: { id: studentIdValue } });
    if (student) return student.id;
  }

  const userIdValue = String(metadata.userId || "");
  if (userIdValue) {
    const student = await prisma.student.findUnique({ where: { userId: userIdValue } });
    if (student) return student.id;
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function persistPaystackTransaction(data: any): Promise<void> {
  const metadata = data.metadata || {};
  const studentId = await resolveStudentId(metadata);
  const reference = String(data.reference || "");
  const paymentStage = String(metadata.paymentStage || metadata.paymentType || "full");
  const paymentType =
    paymentStage === "registration"
      ? "registration"
      : paymentStage === "full"
      ? "full"
      : "deposit";
  const pathwayId = String(metadata.pathwayId || "");
  const pathwayName = String(metadata.pathwayName || "program");
  const paymentAmount = Math.round(Number(data.amount || 0) / 100);
  const currency = String(data.currency || "NGN");
  const depositPercent = Math.round(Number(metadata.depositPercent || 100));
  const tuitionFeeValue = Math.max(0, Math.round(Number(metadata.tuitionFee || 0)));
  const derivedTotal = Math.round(Number(metadata.totalAmount || paymentAmount));
  const totalAmount = tuitionFeeValue > 0 ? Math.max(tuitionFeeValue, derivedTotal) : derivedTotal;
  const paymentClassification = classifyPaymentTransaction({
    paymentAmount,
    totalAmount,
    tuitionFee: tuitionFeeValue,
    depositPercent,
    paymentStage,
    paymentType,
  });
  const effectivePaymentType = paymentClassification.paymentType;
  // A 60% deposit is real money that has cleared, but the account is not
  // settled — it lands as `partial` so the ledger stays honest about the
  // outstanding balance. `isReceivedPayment` counts `partial` everywhere a
  // paid total is summed, so access / certificates / finance are unaffected.
  const settledStatus = effectivePaymentType === "deposit" ? "partial" : "completed";

  if (!studentId || !reference || paymentAmount <= 0) {
    console.error("Paystack persist skipped: invalid metadata", { studentId, reference, paymentAmount, metadata });
    return;
  }

  const existingPayment = await prisma.payment.findFirst({
    where: { stripeSessionId: reference },
    include: { invoice: true },
  });

  if (existingPayment) {
    // Money already recorded (full, or a deposit that landed as `partial`).
    if (isReceivedPayment(existingPayment.status)) {
      return;
    }

    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        status: settledStatus,
        amount: paymentAmount,
        currency,
        method: "paystack",
        description: getPaymentDescription(effectivePaymentType, pathwayName),
        paymentIntentId: reference,
      },
    });

    if (existingPayment.invoiceId) {
      await prisma.invoice.update({
        where: { id: existingPayment.invoiceId },
        data: { status: paymentClassification.invoiceStatus },
      }).catch(() => null);
    }

    await promoteIfNextLevelPayment(studentId, metadata).catch((error) => {
      console.error("Paystack verify: next-level promotion failed", { studentId, reference, error });
    });

    return;
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { user: true },
  });

  if (!student) {
    return;
  }

  const invoice = await prisma.invoice.create({
    data: {
      studentId,
      totalAmount: Math.max(totalAmount || paymentAmount, paymentAmount),
      currency,
      status: paymentClassification.invoiceStatus,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lineItems: {
        pathwayId,
        pathwayName,
        paymentType: effectivePaymentType,
        depositPercent,
      },
    },
  });

  await prisma.payment.create({
    data: {
      studentId,
      invoiceId: invoice.id,
      amount: paymentAmount,
      currency,
      status: settledStatus,
      method: "paystack",
      description: getPaymentDescription(effectivePaymentType, pathwayName),
      stripeSessionId: reference,
      paymentIntentId: reference,
    },
  });

  await enrollIfPathwayExists({ studentId, pathwayId, reference });

  await promoteIfNextLevelPayment(studentId, metadata).catch((error) => {
    console.error("Paystack verify: next-level promotion failed", { studentId, reference, error });
  });
}

/**
 * Enrol the student on the pathway they paid for — if that pathway is real.
 *
 * Deliberately last, deliberately guarded, and deliberately unable to throw.
 * The money and the invoice are what the school and the student actually need
 * recorded; an enrolment row is a convenience. This used to be an unguarded
 * `upsert`, so a metadata pathway id with no matching row raised a foreign-key
 * error AFTER the payment had been written, the caller's catch turned it into
 * "Unable to verify payment", and a student who had just been charged was told
 * their payment failed.
 *
 * Note that portal access does not depend on this: `deriveStudentAccess` reads
 * completed payments, not enrolments.
 */
export async function enrollIfPathwayExists({
  studentId,
  pathwayId,
  reference,
}: {
  studentId: string;
  pathwayId: string;
  reference: string;
}): Promise<void> {
  if (!pathwayId) return;

  try {
    const pathway = await prisma.pathway.findUnique({ where: { id: pathwayId }, select: { id: true } });
    if (!pathway) {
      console.warn("Paystack: skipping enrolment, no such pathway", { pathwayId, reference });
      return;
    }

    await prisma.enrollment.upsert({
      where: { studentId_pathwayId: { studentId, pathwayId } },
      update: { status: "active", stripeSessionId: reference },
      create: { studentId, pathwayId, status: "active", stripeSessionId: reference },
    });
  } catch (error) {
    console.error("Paystack: enrolment failed, payment is still recorded", { pathwayId, reference, error });
  }
}

export type PaystackVerifyResult = {
  /** We reached Paystack and it answered. Says nothing about the transaction. */
  success: boolean;
  status?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
  /**
   * Paystack confirmed the charge but we could not write it down. The student's
   * money is gone and the office has to reconcile by hand, so this is kept
   * separate from a verification failure rather than collapsed into one
   * "something went wrong" — they need completely different responses.
   */
  persistFailed?: boolean;
};

/**
 * Verifies a Paystack transaction by reference and (on success) persists the
 * invoice / payment / enrollment. Safe to call directly from a route handler OR
 * a server component — no HTTP round-trip, so no relative-URL or self-fetch issues.
 */
export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResult> {
  if (!reference) {
    return { success: false, status: 400, error: "Missing reference" };
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { success: false, status: 500, error: "Paystack secret not configured" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );

    data = await safeJson(response);
    if (!response.ok) {
      return {
        success: false,
        status: 502,
        error: data?.message || "Paystack verification failed",
        data,
      };
    }
  } catch (error) {
    console.error("Paystack verify: could not reach Paystack", { reference, error });
    return { success: false, status: 502, error: "Could not reach Paystack to verify this payment" };
  }

  // Persisting is a SEPARATE failure domain from verifying. Folding it into the
  // block above is what produced the original bug: a foreign-key error while
  // recording the payment surfaced to the student as "Unable to verify
  // payment", about a charge Paystack had already confirmed.
  if (data?.data?.status === "success") {
    try {
      await persistPaystackTransaction(data.data);
    } catch (error) {
      console.error("Paystack verify: charge confirmed but could not be recorded", { reference, error });
      return {
        success: true,
        status: 200,
        data,
        persistFailed: true,
        error: "Your payment went through, but we could not update your account automatically.",
      };
    }
  }

  return { success: true, status: 200, data };
}
