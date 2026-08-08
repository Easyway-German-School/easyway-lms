import { NextRequest, NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This school charges through Paystack. Refuse clearly rather than build a
  // checkout session against a client that has no key.
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not enabled on this deployment" }, { status: 501 });
  }

  try {
    const { pathwayId, pathwayName, amount, depositPercent = 100 } = await request.json();

    const normalizedAmount = Math.max(0, Math.round(Number(amount) || 0));
    const normalizedDepositPercent = Math.min(100, Math.max(0, Number(depositPercent) || 100));
    const depositAmount = Math.round(normalizedAmount * (normalizedDepositPercent / 100));
    const amountToCharge = depositAmount > 0 ? depositAmount : normalizedAmount;
    const paymentMode = normalizedDepositPercent < 100 ? "deposit" : "full";

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

    const session_obj = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: pathwayName || "Easyway program",
              description:
                paymentMode === "deposit"
                  ? `Deposit payment for ${pathwayName || "program"}`
                  : `Enrollment in ${pathwayName || "program"}`,
            },
            unit_amount: Math.max(1, amountToCharge),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXTAUTH_URL}/enrollment/success?sessionId={CHECKOUT_SESSION_ID}&mode=${paymentMode}`,
      cancel_url: `${process.env.NEXTAUTH_URL}/programs`,
      client_reference_id: resolvedPathwayId || pathwayId,
      metadata: {
        userId: session.user.id,
        pathwayId: resolvedPathwayId || pathwayId || "",
        pathwayName: pathwayName || "",
        totalAmount: String(normalizedAmount),
        depositAmount: String(amountToCharge),
        depositPercent: String(normalizedDepositPercent),
        paymentType: paymentMode,
      },
    });

    return NextResponse.json({ sessionId: session_obj.id, amount: amountToCharge, paymentMode });
  } catch (error) {
    console.error("Stripe error:", error);
    return NextResponse.json(
      { error: "Payment processing failed" },
      { status: 500 }
    );
  }
}
