import { prisma } from "@/lib/prisma";
import { classifyPaymentTransaction } from "@/lib/payment";
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

  if (!studentId || !reference || paymentAmount <= 0) {
    console.error("Paystack persist skipped: invalid metadata", { studentId, reference, paymentAmount, metadata });
    return;
  }

  const existingPayment = await prisma.payment.findFirst({
    where: { stripeSessionId: reference },
    include: { invoice: true },
  });

  if (existingPayment) {
    if (existingPayment.status === "completed") {
      return;
    }

    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        status: "completed",
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
      status: "completed",
      method: "paystack",
      description: getPaymentDescription(effectivePaymentType, pathwayName),
      stripeSessionId: reference,
      paymentIntentId: reference,
    },
  });

  if (pathwayId) {
    await prisma.enrollment.upsert({
      where: {
        studentId_pathwayId: {
          studentId,
          pathwayId,
        },
      },
      update: {
        status: "active",
        stripeSessionId: reference,
      },
      create: {
        studentId,
        pathwayId,
        status: "active",
        stripeSessionId: reference,
      },
    });
  }
}

export type PaystackVerifyResult = {
  success: boolean;
  status?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
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

    const data = await safeJson(response);
    if (!response.ok) {
      return {
        success: false,
        status: 502,
        error: data?.message || "Paystack verification failed",
        data,
      };
    }

    if (data?.data?.status === "success") {
      await persistPaystackTransaction(data.data);
    }

    return { success: true, status: 200, data };
  } catch (error) {
    console.error("Paystack verify error:", error);
    return { success: false, status: 500, error: "Unable to verify payment" };
  }
}
