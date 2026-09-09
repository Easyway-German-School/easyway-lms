import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoutMetadata, resolveTuitionCheckout } from "@/lib/checkout-amount";
import { flutterwaveConfigured, flutterwaveEmail, initializeFlutterwaveCheckout } from "@/lib/flutterwave";
import { PRIVATE_CLASS_UPGRADE_PRICE } from "@/lib/payment";
import { resolvePayable } from "@/lib/exam-payments";

/**
 * Opens a Flutterwave checkout — the international-card alternative to
 * `/api/paystack/initialize`. Paystack remains the default; a student only
 * reaches here by choosing "Pay with an international card".
 *
 * Same three flows the Paystack side covers, chosen off the body:
 *   default                     tuition / next-level (amount derived server-side)
 *   type=private_class_upgrade  the flat one-to-one upgrade price
 *   kind=exam_fee               one exam-centre sitting fee
 *
 * The naira amount is NEVER taken from the request. Tuition goes through
 * `resolveTuitionCheckout` (shared with Paystack); the other two read a
 * server-fixed price.
 */

export const dynamic = "force-dynamic";

const UNAVAILABLE =
  "International card payment is temporarily unavailable. Please try Paystack, or contact your branch office and they can take the payment directly.";

function base() {
  return process.env.NEXTAUTH_URL || "http://localhost:3000";
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!flutterwaveConfigured()) {
    console.error("Flutterwave checkout blocked: FLW_SECRET_KEY is not set");
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const userId = session.user.id as string;
  const email = flutterwaveEmail(String(session.user.email || ""));

  try {
    const body = await request.json().catch(() => ({}));
    const requestType = String(body?.type ?? "").toLowerCase();
    const kind = String(body?.kind ?? "").toLowerCase();

    // ---- Exam fee -------------------------------------------------------------
    if (kind === "exam_fee") {
      const registrationId = String(body?.registrationId || "");
      if (!registrationId) {
        return NextResponse.json({ error: "registrationId is required" }, { status: 400 });
      }
      const resolved = await resolvePayable(registrationId, { userId, token: body?.token ?? null });
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }
      if (resolved.registration.alreadyPaid) {
        return NextResponse.json({ error: "This fee has already been settled." }, { status: 409 });
      }
      const payerEmail = flutterwaveEmail(resolved.registration.email);
      if (!payerEmail) {
        return NextResponse.json({ error: "A valid email address is needed to pay online." }, { status: 400 });
      }
      const txRef = `exam-flw-${resolved.registration.id}-${Date.now()}`;
      const { link } = await initializeFlutterwaveCheckout({
        email: payerEmail,
        name: resolved.registration.name,
        amountNaira: resolved.registration.fee,
        txRef,
        redirectUrl: `${base()}/exam-centre/paid?registrationId=${resolved.registration.id}&source=flutterwave`,
        title: resolved.registration.examName,
        description: `Exam fee — ${resolved.registration.examName}`,
        meta: {
          kind: "exam_fee",
          registrationId: resolved.registration.id,
          examName: resolved.registration.examName,
        },
      });
      return NextResponse.json({ link, reference: txRef, amount: resolved.registration.fee });
    }

    // Every remaining flow charges the signed-in user, so their email must work.
    if (!email) {
      return NextResponse.json(
        { error: "A valid email address is required to pay online. Please update your account email first." },
        { status: 400 },
      );
    }

    // ---- Private class upgrade ----------------------------------------------
    if (requestType === "private_class_upgrade") {
      const student = await prisma.student.findUnique({
        where: { userId },
        select: { id: true, level: true, classType: true },
      });
      if (!student) {
        return NextResponse.json({ error: "No student record to bill" }, { status: 404 });
      }
      if (student.classType === "private") {
        return NextResponse.json({ error: "You are already on private tuition." }, { status: 409 });
      }
      const txRef = `easyway-flw-private-${Date.now()}-${userId}`;
      const { link } = await initializeFlutterwaveCheckout({
        email,
        name: session.user.name || undefined,
        amountNaira: PRIVATE_CLASS_UPGRADE_PRICE,
        txRef,
        redirectUrl: `${base()}/enrollment/success?source=flutterwave`,
        title: "Private (one-to-one) class upgrade",
        description: "One-time upgrade to private tuition",
        meta: {
          kind: "private_class_upgrade",
          userId,
          studentId: student.id,
          level: student.level ?? "",
        },
      });
      return NextResponse.json({ link, authorizationUrl: link, reference: txRef, amount: PRIVATE_CLASS_UPGRADE_PRICE });
    }

    // ---- Tuition / next-level (amount derived server-side) ------------------
    const resolved = await resolveTuitionCheckout({ userId, body });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { checkout } = resolved;
    const txRef = `easyway-flw-${Date.now()}-${userId}`;

    const { link } = await initializeFlutterwaveCheckout({
      email,
      name: session.user.name || undefined,
      amountNaira: checkout.amountToCharge,
      txRef,
      redirectUrl: `${base()}/enrollment/success?source=flutterwave`,
      title: `Tuition — ${checkout.billingLevel ?? "program"}`,
      description:
        checkout.effectivePaymentType === "full"
          ? `Full payment for ${checkout.pathwayName}`
          : `Part-payment for ${checkout.pathwayName}`,
      meta: checkoutMetadata(checkout, { userId, pathwayId: body?.pathwayId, pathwayName: body?.pathwayName }),
    });

    return NextResponse.json({
      link,
      authorization_url: link,
      reference: txRef,
      amount: checkout.amountToCharge,
      paymentType: checkout.effectivePaymentType,
      breakdown: checkout.breakdown,
    });
  } catch (error) {
    console.error("Flutterwave initialization error:", error);
    return NextResponse.json(
      { error: "We couldn't start your payment just now. Please try again — if it keeps failing, use Paystack or contact your branch office." },
      { status: 500 },
    );
  }
}
