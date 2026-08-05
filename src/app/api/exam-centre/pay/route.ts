import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { safeJson } from "@/lib/safe-json";
import { resolvePayable, settleExamFee } from "@/lib/exam-payments";

/**
 * Paystack checkout for an exam fee.
 *
 * POST  starts a transaction for one registration
 * GET   verifies a reference and settles the registration
 */

export const dynamic = "force-dynamic";

const PAYSTACK_INIT = "https://api.paystack.co/transaction/initialize";
const PAYSTACK_VERIFY = "https://api.paystack.co/transaction/verify";

/**
 * Paystack rejects reserved TLDs (.test, .local) with "Invalid Email Address
 * Passed", which would block checkout for seeded accounts in development.
 */
function paystackEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  const reserved = /\.(test|local|localhost|example|invalid)$/i.test(value);
  if (!reserved) return value;
  return process.env.NODE_ENV !== "production" ? "candidate@example.com" : null;
}

export async function POST(req: NextRequest) {
  try {
    const { registrationId, token } = await req.json();
    if (!registrationId) {
      return NextResponse.json({ error: "registrationId is required" }, { status: 400 });
    }

    const session = (await getServerSession(authOptions as any)) as any;
    const resolved = await resolvePayable(registrationId, {
      userId: session?.user?.id ?? null,
      token,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const registration = resolved.registration;
    if (registration.alreadyPaid) {
      return NextResponse.json({ error: "This fee has already been settled." }, { status: 409 });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
    }

    const email = paystackEmail(registration.email);
    if (!email) {
      return NextResponse.json(
        { error: "A valid email address is needed to pay online." },
        { status: 400 },
      );
    }

    const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const reference = `exam-${registration.id}-${Date.now()}`;

    const response = await fetch(PAYSTACK_INIT, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        // Amount comes from the Exam record, never the request body — the
        // client must not be able to decide what an exam costs.
        amount: registration.fee * 100,
        currency: "NGN",
        reference,
        callback_url: `${base}/exam-centre/paid?registrationId=${registration.id}`,
        metadata: {
          kind: "exam_fee",
          registrationId: registration.id,
          examName: registration.examName,
        },
      }),
    });

    const data = await safeJson(response);
    if (!response.ok || !data?.status) {
      throw new Error(data?.message || "Paystack initialization failed");
    }

    return NextResponse.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      amount: registration.fee,
    });
  } catch (error) {
    console.error("Exam fee checkout failed:", error);
    return NextResponse.json({ error: "Could not start payment" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference");
  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Paystack is not configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${PAYSTACK_VERIFY}/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const data = await safeJson(response);

    if (!response.ok || !data?.status || data.data?.status !== "success") {
      return NextResponse.json(
        { paid: false, error: data?.data?.gateway_response || "Payment was not successful" },
        { status: 402 },
      );
    }

    const metadata = data.data.metadata ?? {};
    const registrationId = String(metadata.registrationId || "");
    if (metadata.kind !== "exam_fee" || !registrationId) {
      return NextResponse.json({ error: "That reference is not an exam fee." }, { status: 400 });
    }

    // Trust Paystack's amount, not the metadata, and convert back from kobo.
    const amount = Math.round(Number(data.data.amount || 0) / 100);

    const result = await settleExamFee({ registrationId, reference, amount });
    if (!result.settled) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }

    // The receipt is queued inside settleExamFee, so it goes out exactly once
    // whether this redirect or the webhook settled it first.

    return NextResponse.json({
      paid: true,
      amount,
      alreadySettled: result.alreadySettled,
      registrationId,
    });
  } catch (error) {
    console.error("Exam fee verification failed:", error);
    return NextResponse.json({ error: "Could not verify that payment" }, { status: 500 });
  }
}
