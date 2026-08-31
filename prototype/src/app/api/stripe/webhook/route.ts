import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { withUnscoped } from "@/lib/tenant/context";

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

async function handlePOST(request: NextRequest) {
  // Answered before anything is read. On a deployment that takes payment
  // through Paystack this route is dead weight, and it should say so plainly
  // rather than throw an unconfigured-client error that reads like a bug.
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not enabled on this deployment" }, { status: 501 });
  }

  const sig = request.headers.get("stripe-signature") || "";
  const body = await request.text();

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(body, sig, endpointSecret) as Stripe.Event;
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      const studentId = session.metadata?.userId;
      const pathwayId = session.metadata?.pathwayId;
      const pathwayName = session.metadata?.pathwayName || "program";
      const totalAmount = Number(session.metadata?.totalAmount ?? session.amount_total ?? 0);
      const paymentAmount = session.amount_total ?? 0;
      const paymentType = session.metadata?.paymentType || "full";
      const depositPercent = Number(session.metadata?.depositPercent ?? 100);

      if (studentId && pathwayId) {
        await prisma.enrollment.upsert({
          where: {
            studentId_pathwayId: {
              studentId,
              pathwayId,
            },
          },
          update: {
            stripeSessionId: session.id,
            status: "active",
          },
          create: {
            studentId,
            pathwayId,
            stripeSessionId: session.id,
            status: "active",
          },
        });
      }

      if (studentId) {
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent && typeof session.payment_intent !== "string"
              ? session.payment_intent.id
              : null;

        const invoice = await prisma.invoice.create({
          data: {
            studentId,
            totalAmount: Math.max(totalAmount, paymentAmount),
            currency: (session.currency ?? "usd") as string,
            status: totalAmount > paymentAmount ? "partial" : "paid",
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            lineItems: {
              pathwayId,
              pathwayName,
              paymentType,
              depositPercent,
            },
          },
        });

        await prisma.payment.create({
          data: {
            studentId,
            invoiceId: invoice.id,
            amount: paymentAmount,
            currency: (session.currency ?? "usd") as string,
            // A deposit clears as `partial` — real money in, balance still
            // owed. Counted everywhere via `isReceivedPayment`.
            status: paymentType === "deposit" ? "partial" : "completed",
            method: "card",
            description:
              paymentType === "deposit"
                ? `Deposit payment for ${pathwayName}`
                : `Full payment for ${pathwayName}`,
            stripeSessionId: session.id,
            paymentIntentId,
          },
        });

        const notificationMessage =
          paymentType === "deposit"
            ? `We received your ${depositPercent}% deposit for ${pathwayName}. Your access is active and the remaining balance is now due.`
            : `Your payment for ${pathwayName} was completed successfully.`;

        if (paymentType === "deposit" && totalAmount > paymentAmount) {
          const reminder = await prisma.notification.create({
            data: {
              studentId,
              title: "Remaining balance due",
              message: `Your ${depositPercent}% deposit for ${pathwayName} has been received. Please pay the remaining balance to continue your learning without interruption.`,
              channel: "email",
              status: "pending",
            },
          });

          const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: { user: true },
          });

          if (student?.user?.email) {
            await sendEmail({
              to: student.user.email,
              subject: "Remaining balance due for your Easyway program",
              html: `<p>Hello ${student.user.name || "there"},</p><p>${reminder.message}</p><p>Thank you,<br/>Easyway LMS</p>`,
            });
          }
        }

        const confirmation = await prisma.notification.create({
          data: {
            studentId,
            title: paymentType === "deposit" ? "Part-payment received" : "Payment received",
            message: notificationMessage,
            channel: "email",
            status: "pending",
          },
        });

        const student = await prisma.student.findUnique({
          where: { id: studentId },
          include: { user: true },
        });

        if (student?.user?.email) {
          await sendEmail({
            to: student.user.email,
            subject: paymentType === "deposit" ? "Your deposit payment was received" : "Your Easyway payment was received",
            html: `<p>Hello ${student.user.name || "there"},</p><p>${confirmation.message}</p><p>Thank you,<br/>Easyway LMS</p>`,
          });
        }
      }

      console.log("Webhook processed for session:", session.id);
    } catch (error) {
      console.error("Error processing webhook event:", error);
    }
  }

  return NextResponse.json({ received: true });
}

/**
 * Wrapped rather than marked inside the body: the scope has to be
 * established before the handler runs, not on its first line. See
 * withUnscoped in src/lib/tenant/context.ts.
 */
export const POST = withUnscoped(
  "payment provider webhook carries no tenant; the payment record identifies it",
  handlePOST,
);
