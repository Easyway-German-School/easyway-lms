import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/safe-json";
import {
  DEPOSIT_RATE,
  isLevelSellable,
  REGISTRATION_FEE,
  requiredDepositFor,
  tuitionFeeFor,
} from "@/lib/payment";

/**
 * Opens a Paystack checkout.
 *
 * The client picks a STAGE — full, deposit or registration — and nothing more.
 * It used to send the naira figure and the tuition fee too, which the route
 * charged as given: anyone could post `amount: 100, paymentStage: "full"` from
 * devtools and be recorded as having settled their tuition. The price is now
 * derived here from the student's own level and branch, which is also the only
 * way the Abuja premium can be enforced.
 */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pathwayId, pathwayName } = body ?? {};
    const requestedStage = String(body?.paymentStage ?? body?.stage ?? "full").toLowerCase();

    const studentRecord = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
      select: {
        id: true,
        level: true,
        classType: true,
        branch: { select: { name: true } },
        payments: { where: { status: "completed" }, select: { amount: true } },
      },
    });

    if (!studentRecord) {
      return NextResponse.json({ error: "No student record to bill" }, { status: 404 });
    }

    const feeLookup = { level: studentRecord.level, branch: studentRecord.branch?.name ?? null, classType: studentRecord.classType };
    const normalizedTuitionFee = tuitionFeeFor(feeLookup);
    const requiredDeposit = requiredDepositFor(feeLookup);
    const alreadyPaid = studentRecord.payments.reduce((sum, payment) => sum + payment.amount, 0);

    if (requestedStage !== "registration" && !isLevelSellable(studentRecord.level)) {
      return NextResponse.json(
        {
          error:
            `${studentRecord.level} tuition is quoted by your branch office rather than the portal. Please contact them to pay.`,
        },
        { status: 409 },
      );
    }

    // What is genuinely still owed at each stage — never more, so a student who
    // has already deposited is charged the balance instead of the whole fee again.
    const paymentType =
      requestedStage === "registration" ? "registration" : requestedStage === "deposit" ? "deposit" : "full";
    const amountToCharge =
      paymentType === "registration"
        ? REGISTRATION_FEE
        : paymentType === "deposit"
        ? Math.max(0, requiredDeposit - alreadyPaid)
        : Math.max(0, normalizedTuitionFee - alreadyPaid);

    if (amountToCharge <= 0) {
      return NextResponse.json(
        { error: "There is nothing outstanding on your tuition for this level." },
        { status: 409 },
      );
    }

    const normalizedDepositPercent = paymentType === "deposit" ? Math.round(DEPOSIT_RATE * 100) : 100;
    const requiredThreshold = paymentType === "deposit" ? requiredDeposit : normalizedTuitionFee;

    const resolvedPathway = await prisma.pathway.findFirst({
      where: {
        OR: [
          { id: String(pathwayId || "") },
          { name: pathwayName || "" },
          { name: String(pathwayId || "") },
        ],
      },
    });

    // `pathwayId` in the metadata must be a REAL Pathway row id or nothing at
    // all. It used to fall back to whatever the client sent — and the client
    // sends a display name ("Nursing career path"), three of which have no
    // Pathway row. That name then travelled to Paystack and came back on the
    // callback, where enrolling the student blew up on the foreign key and took
    // the whole verification down with it: money charged, "Unable to verify
    // payment" on screen. The enrolment is optional; a wrong id is not.
    const resolvedPathwayId = resolvedPathway?.id ?? "";
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enrollment/success`;
    const callbackUrl = `${callbackUrlBase}${callbackUrlBase.includes("?") ? "&" : "?"}source=paystack`;

    const studentId = studentRecord.id;

    const userEmail = String(session.user.email || "").trim().toLowerCase();
    const validEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isDev = process.env.NODE_ENV !== "production";
    // Paystack rejects reserved/non-routable TLDs (e.g. .test, .local) with
    // "Invalid Email Address Passed". These pass the regex above, so in
    // development we substitute a Paystack-acceptable email so checkout still opens.
    const reservedTld = /\.(test|local|localhost|example|invalid)$/i.test(userEmail);
    const paystackEmail = validEmailPattern.test(userEmail) && !(reservedTld && isDev)
      ? userEmail
      : isDev
      ? "student@example.com"
      : null;

    if (!secretKey) {
      return NextResponse.json({ error: "Paystack is not configured" }, { status: 500 });
    }

    if (!paystackEmail) {
      return NextResponse.json(
        {
          error: "A valid email address is required to process Paystack payments. Please update your account email before proceeding.",
        },
        { status: 400 }
      );
    }

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: paystackEmail,
        amount: amountToCharge * 100,
        currency: "NGN",
        reference: `easyway-${Date.now()}-${session.user.id}`,
        callback_url: callbackUrl,
        metadata: {
          userId: session.user.id,
          studentId,
          pathwayId: resolvedPathwayId,
          // The name is free text and only ever used for wording the receipt,
          // so it keeps the client's value even when no row matched.
          pathwayName: pathwayName || String(pathwayId || ""),
          totalAmount: String(normalizedTuitionFee),
          depositAmount: String(amountToCharge),
          tuitionFee: String(normalizedTuitionFee),
          requiredThreshold: String(requiredThreshold),
          depositPercent: String(normalizedDepositPercent),
          paymentType,
          paymentStage: paymentType,
        },
      }),
    });

    const paystackData = await safeJson(paystackResponse);
    if (!paystackResponse.ok || !paystackData || !paystackData.status) {
      throw new Error(paystackData?.message || "Paystack initialization failed");
    }

    return NextResponse.json({
      authorization_url: paystackData.data.authorization_url,
      reference: paystackData.data.reference,
      amount: amountToCharge,
      paymentType,
    });
  } catch (error) {
    console.error("Paystack initialization error:", error);
    return NextResponse.json({ error: "Payment processing failed" }, { status: 500 });
  }
}
