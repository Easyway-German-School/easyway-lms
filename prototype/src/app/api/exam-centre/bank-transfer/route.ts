import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import {
  manualBankTransferDetails,
  resolvePayable,
  submitBankTransferProof,
} from "@/lib/exam-payments";

/**
 * The manual Moniepoint bank-transfer alternative to the Paystack checkout in
 * ./pay/route.ts. See the doc comment on manualBankTransferDetails() for why
 * this is one static account rather than a per-booking reserved one.
 *
 * GET  the account to pay into, plus the fee, for one registration.
 * POST the uploaded slip — sets pending_verification; an admin still has to
 *      confirm the money landed (src/app/api/admin/exams/route.ts PATCH).
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const registrationId = req.nextUrl.searchParams.get("registrationId");
    const token = req.nextUrl.searchParams.get("token");
    if (!registrationId) {
      return NextResponse.json({ error: "registrationId is required" }, { status: 400 });
    }

    const session = await requireAuthSession();
    const resolved = await resolvePayable(registrationId, { userId: session?.user?.id ?? null, token });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    return NextResponse.json({
      account: manualBankTransferDetails(),
      fee: resolved.registration.fee,
      examName: resolved.registration.examName,
      alreadyPaid: resolved.registration.alreadyPaid,
    });
  } catch (error) {
    console.error("Exam bank-transfer GET failed:", error);
    return NextResponse.json({ error: "Could not load payment details" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { registrationId, token, transferProofUrl, transferReference } = await req.json();
    if (!registrationId || !transferProofUrl) {
      return NextResponse.json({ error: "registrationId and transferProofUrl are required" }, { status: 400 });
    }

    const session = await requireAuthSession();
    const result = await submitBankTransferProof({
      registrationId,
      userId: session?.user?.id ?? null,
      token: token ?? null,
      transferProofUrl,
      transferReference: transferReference ?? null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Exam bank-transfer POST failed:", error);
    return NextResponse.json({ error: "Could not submit that payment" }, { status: 500 });
  }
}
