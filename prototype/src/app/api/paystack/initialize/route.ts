import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/safe-json";
import {
  DEPOSIT_RATE,
  isLevelSellable,
  PRIVATE_CLASS_UPGRADE_PRICE,
  REGISTRATION_FEE,
  requiredDepositFor,
  tuitionFeeFor,
} from "@/lib/payment";
import { nextLevelAfter } from "@/lib/levels";

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
    const requestType = String(body?.type ?? "").toLowerCase();
    const forNextLevel = Boolean(body?.forNextLevel);

    const studentRecord = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
      select: {
        id: true,
        level: true,
        classType: true,
        levelCompletedFor: true,
        levelCompletedAt: true,
        branch: { select: { name: true } },
        payments: { where: { status: "completed" }, select: { amount: true } },
      },
    });

    if (!studentRecord) {
      return NextResponse.json({ error: "No student record to bill" }, { status: 404 });
    }

    /**
     * PRIVATE CLASS UPGRADE — a separate, simpler checkout from the tuition
     * flow below. One flat price, no stages, no deposit — a student either
     * pays for one-to-one tuition or does not. Branched here, before the
     * tuition-specific lookups, because none of that logic (sellable levels,
     * deposit stages, pathway enrolment) applies to this purchase.
     */
    if (requestType === "private_class_upgrade") {
      if (studentRecord.classType === "private") {
        return NextResponse.json({ error: "You are already on private tuition." }, { status: 409 });
      }

      const userEmail = String(session.user.email || "").trim().toLowerCase();
      const validEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!validEmailPattern.test(userEmail)) {
        return NextResponse.json(
          { error: "A valid email address is required to process Paystack payments. Please update your account email before proceeding." },
          { status: 400 },
        );
      }

      const secretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!secretKey) {
        return NextResponse.json({ error: "Paystack is not configured" }, { status: 500 });
      }

      const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enrollment/success`;
      const callbackUrl = `${callbackUrlBase}${callbackUrlBase.includes("?") ? "&" : "?"}source=paystack`;

      const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userEmail,
          amount: PRIVATE_CLASS_UPGRADE_PRICE * 100,
          currency: "NGN",
          reference: `easyway-private-${Date.now()}-${session.user.id}`,
          callback_url: callbackUrl,
          metadata: {
            kind: "private_class_upgrade",
            userId: session.user.id,
            studentId: studentRecord.id,
            level: studentRecord.level,
          },
        }),
      });

      const paystackData = await safeJson(paystackResponse);
      if (!paystackResponse.ok || !paystackData || !paystackData.status) {
        throw new Error(paystackData?.message || "Paystack initialization failed");
      }

      return NextResponse.json({
        authorizationUrl: paystackData.data.authorization_url,
        authorization_url: paystackData.data.authorization_url,
        reference: paystackData.data.reference,
        amount: PRIVATE_CLASS_UPGRADE_PRICE,
      });
    }

    /**
     * NEXT-LEVEL CHECKOUT — a student who just had their level signed off
     * paying for the level after it, not a top-up on the one they finished.
     *
     * Billed against `nextLevelAfter(level)`, and re-verified here rather than
     * trusted from the client: `forNextLevel` only ever reaches this branch
     * from the "Continue to X" link on an offer the server already decided was
     * eligible, but nothing stops a request being replayed after that changed.
     *
     * `alreadyPaid` is deliberately NOT the student's cumulative payment
     * history here. `Payment` rows carry no record of which level they were
     * for, so summing everything ever paid would net a brand-new level's
     * deposit against tuition paid on the level just finished — in practice,
     * "nothing outstanding" on a level nobody has paid a naira toward yet.
     * A fresh level starts its own ledger at zero.
     */
    let billingLevel = studentRecord.level;
    let alreadyPaid = studentRecord.payments.reduce((sum, payment) => sum + payment.amount, 0);

    if (forNextLevel) {
      if (studentRecord.levelCompletedFor !== studentRecord.level || !studentRecord.levelCompletedAt) {
        return NextResponse.json(
          { error: "Your level has not been signed off yet — nothing to continue to." },
          { status: 409 },
        );
      }

      const target = nextLevelAfter(studentRecord.level);
      if (!target) {
        return NextResponse.json({ error: "You are already at the top of the ladder." }, { status: 409 });
      }

      billingLevel = target;
      alreadyPaid = 0;
    }

    const feeLookup = { level: billingLevel, branch: studentRecord.branch?.name ?? null, classType: studentRecord.classType };
    const normalizedTuitionFee = tuitionFeeFor(feeLookup);
    const requiredDeposit = requiredDepositFor(feeLookup);

    if (requestedStage !== "registration" && !isLevelSellable(billingLevel)) {
      return NextResponse.json(
        {
          error:
            `${billingLevel} tuition is quoted by your branch office rather than the portal. Please contact them to pay.`,
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
          forNextLevel: forNextLevel ? "true" : "false",
          targetLevel: billingLevel,
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
