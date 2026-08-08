import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { classifyPaymentTransaction } from "@/lib/payment";
import { settleExamFee } from "@/lib/exam-payments";
import { enrollIfPathwayExists } from "@/lib/paystack-verify";
import { KIND, notifyInBackground } from "@/lib/notify";

// Paystack signs every webhook with HMAC SHA512 of the raw body, keyed by the
// secret key, in the x-paystack-signature header. Without this check anyone who
// knows the URL can POST a charge.success and unlock paid content for free.
function isValidPaystackSignature(rawBody: string, signature: string | null) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey || !signature) return false;

  const expected = crypto
    .createHmac("sha512", secretKey)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getPaymentDescription(paymentType: string, pathwayName: string) {
  if (paymentType === "registration") {
    return `Registration fee for ${pathwayName}`;
  }

  if (paymentType === "deposit") {
    return `Deposit payment for ${pathwayName}`;
  }

  return `Full payment for ${pathwayName}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.text();

    if (!isValidPaystackSignature(body, request.headers.get("x-paystack-signature"))) {
      console.error("Paystack webhook rejected: invalid or missing signature");
      // Either somebody is POSTing at the endpoint, or PAYSTACK_SECRET_KEY no
      // longer matches the dashboard — in which case every real payment is
      // being rejected too, silently, until somebody notices. Worth waking the
      // office for.
      notifyInBackground({
        to: { audience: "admin", capability: "payments" },
        kind: KIND.gatewayError,
        severity: "critical",
        title: "Paystack webhook rejected",
        message:
          "A payment webhook arrived with an invalid signature. If payments are not appearing, check that PAYSTACK_SECRET_KEY matches the key in the Paystack dashboard.",
        link: "/admin/payments",
        // One alert per hour at most, however many bad requests arrive.
        dedupeKey: `gateway-signature-${new Date().toISOString().slice(0, 13)}`,
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const event = payload.event;

    if (event !== "charge.success") {
      return NextResponse.json({ received: true });
    }

    const data = payload.data || {};
    const metadata = data.metadata || {};

    // Exam fees settle here as well as on the redirect. Relying on the
    // redirect alone loses the payment whenever someone closes the tab on
    // Paystack's success page — the money is taken and the seat stays unpaid.
    // settleExamFee is idempotent, so both paths arriving is harmless.
    if (metadata.kind === "exam_fee" && metadata.registrationId) {
      const amount = Math.round(Number(data.amount || 0) / 100);
      const result = await settleExamFee({
        registrationId: String(metadata.registrationId),
        reference: String(data.reference || ""),
        amount,
      });
      return NextResponse.json({ received: true, examFee: result });
    }

    const rawStudentId = String(metadata.studentId || metadata.userId || "");
    const pathwayId = String(metadata.pathwayId || "");
    const pathwayName = metadata.pathwayName || "program";
    const tuitionFeeValue = Math.max(0, Math.round(Number(metadata.tuitionFee || 0)));
    const derivedTotal = Math.round(Number(metadata.totalAmount || 0));
    const totalAmount = tuitionFeeValue > 0 ? Math.max(tuitionFeeValue, derivedTotal) : derivedTotal;
    const paymentAmount = Math.round(Number(data.amount || 0) / 100);
    const paymentStage = String(metadata.paymentStage || metadata.paymentType || "full");
    const paymentType = paymentStage === "registration" ? "registration" : paymentStage === "full" ? "full" : "deposit";
    const depositPercent = Number(metadata.depositPercent || 100);
    const paymentClassification = classifyPaymentTransaction({
      paymentAmount,
      totalAmount,
      tuitionFee: tuitionFeeValue,
      depositPercent,
      paymentStage,
      paymentType,
    });
    const effectivePaymentType = paymentClassification.paymentType;

    // Only the student is required. Dropping the payment because no pathway id
    // came back would now discard most of them — `initialize` sends an empty
    // pathwayId whenever the chosen programme has no Pathway row, rather than
    // the display name it used to fall back to. The money still has to land.
    if (!rawStudentId) {
      console.error("Paystack webhook missing student metadata", { metadata });
      return NextResponse.json({ received: true });
    }

    const student =
      (await prisma.student.findUnique({ where: { id: rawStudentId }, include: { user: true } })) ||
      (await prisma.student.findUnique({ where: { userId: rawStudentId }, include: { user: true } }));

    if (!student) {
      console.error("Paystack webhook could not resolve student", { rawStudentId, metadata });
      return NextResponse.json({ received: true });
    }

    const paymentReference = String(data.reference || "");

    // Enrolment deliberately does NOT run before this point. It used to: an
    // unguarded upsert sat directly above, and a pathway id with no matching
    // row threw a foreign-key error that 500'd the handler before the payment
    // was written — money taken, nothing in the ledger. Recording the money now
    // comes first, and enrolment happens afterwards through a helper that
    // cannot throw. See `enrollIfPathwayExists`.

    const existingPayment = paymentReference
      ? await prisma.payment.findFirst({ where: { stripeSessionId: paymentReference } })
      : null;

    if (existingPayment) {
      if (existingPayment.status === "completed") {
        return NextResponse.json({ received: true });
      }

      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: "completed",
          amount: paymentAmount,
          currency: "NGN",
          method: "paystack",
          description: getPaymentDescription(effectivePaymentType, pathwayName),
          paymentIntentId: paymentReference,
        },
      });

      /**
       * Mark the invoice paid — but only when there is one.
       *
       * This was `where: { id: existingPayment.invoiceId ?? "" }` with a
       * `.catch(() => null)`. Twenty-one of thirty-six completed payments have
       * no invoice, so that fell through to a lookup for id `""`, Prisma threw
       * P2025, and the catch ate it. Nothing was broken by it — those payments
       * genuinely have no invoice to update — but it meant a REAL failure here
       * was indistinguishable from the ordinary case. A connection blip while
       * marking an invoice paid would leave a student showing as owing money
       * they had paid, behind a paywall, and nobody would ever find out.
       *
       * Now the no-invoice case is a condition rather than an exception, and a
       * genuine failure is logged loudly instead of discarded. Still not
       * allowed to throw: the money is already recorded above, and rejecting
       * the webhook would make Paystack retry a payment we have accepted.
       */
      if (existingPayment.invoiceId) {
        try {
          await prisma.invoice.update({
            where: { id: existingPayment.invoiceId },
            data: { status: paymentClassification.invoiceStatus },
          });
        } catch (error) {
          console.error(
            `[paystack] payment ${existingPayment.id} recorded, but invoice ${existingPayment.invoiceId} could not be marked ${paymentClassification.invoiceStatus}:`,
            error,
          );
        }
      }

      await enrollIfPathwayExists({ studentId: student.id, pathwayId, reference: paymentReference });

      return NextResponse.json({ received: true });
    }

    const invoice = await prisma.invoice.create({
      data: {
        studentId: student.id,
        totalAmount: Math.max(totalAmount || paymentAmount, paymentAmount),
        currency: "NGN",
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

    const payment = await prisma.payment.create({
      data: {
        studentId: student.id,
        invoiceId: invoice.id,
        amount: paymentAmount,
        currency: "NGN",
        status: "completed",
        method: "paystack",
        description: getPaymentDescription(effectivePaymentType, pathwayName),
        stripeSessionId: paymentReference,
        paymentIntentId: paymentReference,
      },
    });

    await enrollIfPathwayExists({ studentId: student.id, pathwayId, reference: paymentReference });

    const notificationMessage =
      effectivePaymentType === "registration"
        ? `We received your registration fee for ${pathwayName}. Your account is active. Pay the remaining deposit to unlock the full program library.`
        : effectivePaymentType === "deposit"
        ? `We received your ${depositPercent}% deposit for ${pathwayName}. Your access is active and the remaining balance is now due.`
        : `Your payment for ${pathwayName} was completed successfully.`;

    if (effectivePaymentType === "registration") {
      const reminder = await prisma.notification.create({
        data: {
          studentId: student.id,
          title: "Deposit balance due",
          message: `Your registration fee for ${pathwayName} has been received. Please pay the remaining deposit to unlock premium content.`,
          channel: "email",
          status: "pending",
        },
      });

      if (student.user?.email) {
        await sendEmail({
          to: student.user.email,
          subject: "Registration fee received — next deposit due",
          html: `<p>Hello ${student.user.name || "there"},</p><p>${reminder.message}</p><p>Thank you,<br/>Easyway LMS</p>`,
        });
      }
    }

    if (effectivePaymentType === "deposit" && totalAmount > paymentAmount) {
      const reminder = await prisma.notification.create({
        data: {
          studentId: student.id,
          title: "Remaining balance due",
          message: `Your ${depositPercent}% deposit for ${pathwayName} has been received. Please pay the remaining balance to continue your learning without interruption.`,
          channel: "email",
          status: "pending",
        },
      });

      if (student.user?.email) {
        await sendEmail({
          to: student.user.email,
          subject: "Remaining balance due for your Easyway program",
          html: `<p>Hello ${student.user.name || "there"},</p><p>${reminder.message}</p><p>Thank you,<br/>Easyway LMS</p>`,
        });
      }
    }

    const confirmation = await prisma.notification.create({
      data: {
        studentId: student.id,
        title:
          effectivePaymentType === "registration"
            ? "Registration fee received"
            : effectivePaymentType === "deposit"
            ? "Part-payment received"
            : "Payment received",
        message: notificationMessage,
        channel: "email",
        status: "pending",
      },
    });

    if (student.user?.email) {
      await sendEmail({
        to: student.user.email,
        subject: effectivePaymentType === "deposit" ? "Your deposit payment was received" : "Your Easyway payment was received",
        html: `<p>Hello ${student.user.name || "there"},</p><p>${confirmation.message}</p><p>Thank you,<br/>Easyway LMS</p>`,
      });
    }

    // The rows above are email records — channel "email", which the bell
    // deliberately excludes. The student also needs to see this in the portal,
    // and the office needs to know money arrived without watching Paystack.
    notifyInBackground({
      to: { studentIds: [student.id] },
      kind: KIND.paymentReceived,
      severity: "success",
      title: confirmation.title,
      message: notificationMessage,
      link: "/payments",
    });

    notifyInBackground({
      to: { audience: "admin", capability: "payments" },
      kind: KIND.paymentReceived,
      severity: "success",
      title: `₦${paymentAmount.toLocaleString()} received`,
      message: `${student.user?.name || "A student"} paid ₦${paymentAmount.toLocaleString()} (${effectivePaymentType}) for ${pathwayName}.`,
      link: "/admin/payments",
      // The office wants to hear this one, so it overrides the default of
      // pushing only for warnings and above.
      push: true,
    });

    // Send welcome email if this is a 100% full payment
    if (effectivePaymentType === "full" && student.user?.email) {
      try {
        // Import here to avoid circular dependencies
        const { welcomeEmailTemplate } = await import("@/lib/email-templates");
        const template = welcomeEmailTemplate(student.user.name || "Student", pathwayName);
        
        await sendEmail({
          to: student.user.email,
          subject: template.subject,
          html: template.html,
        });

        // Mark welcome email as sent
        await prisma.payment.update({
          where: { id: payment.id || "" },
          data: { welcomeEmailSentAt: new Date() },
        }).catch(() => null);

        // Log the email
        await prisma.emailLog.create({
          data: {
            studentId: student.id,
            recipientEmail: student.user.email,
            type: "welcome",
            subject: template.subject,
            status: "sent",
          },
        }).catch(() => null);
      } catch (error) {
        console.error("Error sending welcome email:", error);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook error:", error);
    // A payment was taken and we failed to record it. Somebody has to
    // reconcile that by hand, so somebody has to be told.
    notifyInBackground({
      to: { audience: "admin", capability: "payments" },
      kind: KIND.gatewayError,
      severity: "critical",
      title: "Payment webhook failed",
      message: `A Paystack webhook could not be processed: ${
        error instanceof Error ? error.message : "unknown error"
      }. The money may have been taken without the payment being recorded — check the Paystack dashboard against Payments.`,
      link: "/admin/payments",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
