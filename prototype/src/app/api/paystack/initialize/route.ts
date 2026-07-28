import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeJson } from "@/lib/safe-json";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { pathwayId, pathwayName, amount, depositPercent = 100, tuitionFee, paymentStage } = await request.json();

    const normalizedAmount = Math.max(0, Math.round(Number(amount) || 0));
    const normalizedTuitionFee = Math.max(0, Math.round(Number(tuitionFee) || 0));
    const normalizedDepositPercent = Math.min(100, Math.max(0, Number(depositPercent) || 100));
    const normalizedPaymentStage = typeof paymentStage === "string" ? paymentStage : "";
    const amountToCharge = normalizedAmount;
    const paymentType = normalizedPaymentStage === "registration"
      ? "registration"
      : normalizedPaymentStage === "full"
      ? "full"
      : normalizedDepositPercent < 100
      ? "deposit"
      : "full";
    const requiredThreshold = normalizedTuitionFee > 0 ? Math.round(normalizedTuitionFee * (normalizedDepositPercent / 100)) : 0;

    const resolvedPathway = await prisma.pathway.findFirst({
      where: {
        OR: [
          { id: String(pathwayId || "") },
          { name: pathwayName || "" },
          { name: String(pathwayId || "") },
        ],
      },
    });

    const resolvedPathwayId = resolvedPathway?.id ?? null;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enrollment/success`;
    const callbackUrl = `${callbackUrlBase}${callbackUrlBase.includes("?") ? "&" : "?"}source=paystack`;

    const studentRecord = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
    });
    const studentId = studentRecord?.id;

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
          pathwayId: resolvedPathwayId || pathwayId || "",
          pathwayName: pathwayName || "",
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
