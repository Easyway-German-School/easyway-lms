import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { submitExamDocuments } from "@/lib/exam-documents";

/**
 * Upload the passport photo + passport data page for one booking.
 *
 * Reachable by a signed-in owner OR by the payToken issued when the booking
 * was made — a new candidate has not set a password yet and still needs to
 * finish their booking. See resolvePayable/payToken in src/lib/exam-payments.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { registrationId, token, passportPhotoUrl, passportDataPageUrl } = await req.json();
    if (!registrationId) {
      return NextResponse.json({ error: "registrationId is required" }, { status: 400 });
    }

    // Anonymous candidates authenticate with the token instead — no hard
    // sign-in requirement here.
    const session = await requireAuthSession();

    const result = await submitExamDocuments(
      registrationId,
      { userId: session?.user?.id ?? null, token: token ?? null },
      { passportPhotoUrl, passportDataPageUrl },
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Exam document upload failed:", error);
    return NextResponse.json({ error: "Could not save those documents" }, { status: 500 });
  }
}
