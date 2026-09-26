import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { cancelBooking, confirmBookingPayment, markNoShow, rejectBookingPayment, reviewBookingDocuments } from "@/lib/booking";
import { admitCandidate, markCertificateDelivered, markCertificateReady, releaseResult } from "@/lib/lifecycle";
import { sendJourneyStep } from "@/lib/journey";
import { JOURNEY_ORDER, type JourneyStep } from "@/lib/journey-emails";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One admin action per call: verify/reject payment, review documents, admit, release a result, certificate steps, resend an email, cancel, or mark a no-show. */
export const PATCH = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { transferAction, transferRejectReason, documentAction, documentRejectReason, cancelReason, markNoShow: shouldMarkNoShow } = body;

  if (cancelReason !== undefined) {
    const result = await cancelBooking(id, String(cancelReason || "Cancelled by the office."));
    return NextResponse.json({ ok: true, ...result });
  }
  if (shouldMarkNoShow) {
    await markNoShow(id);
    return NextResponse.json({ ok: true });
  }

  if (transferAction === "verify") {
    // The three figures the invoice's PAYMENT CONFIRMATION block asks for.
    // Admin identity here is deliberately "the office" (see lib/admin-auth.ts)
    // — this app has one shared password, not per-person accounts.
    const amount = body.amountReceived !== undefined ? Number(body.amountReceived) : undefined;
    if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) {
      return NextResponse.json({ error: "Enter the amount received as a whole number of naira." }, { status: 400 });
    }
    const paidOn = body.paidOn ? new Date(String(body.paidOn)) : undefined;
    if (paidOn && Number.isNaN(paidOn.getTime())) return NextResponse.json({ error: "Enter a valid date received." }, { status: 400 });

    const result = await confirmBookingPayment(id, "office", {
      paymentMethod: "bank_transfer",
      expectedAmount: amount,
      paidOn,
      reference: body.transactionReference ? String(body.transactionReference).trim() : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, seatNumber: result.seatNumber, alreadyConfirmed: result.alreadyConfirmed });
  }
  if (transferAction === "reject") {
    await rejectBookingPayment(id, String(transferRejectReason || "The transfer could not be confirmed."));
    return NextResponse.json({ ok: true });
  }
  if (documentAction === "approved" || documentAction === "rejected") {
    await reviewBookingDocuments(id, documentAction, documentRejectReason ?? null);
    return NextResponse.json({ ok: true });
  }

  if (body.admit) {
    const result = await admitCandidate(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (body.releaseResult) {
    const result = await releaseResult(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (body.certificateReady !== undefined) {
    const result = await markCertificateReady(id, String(body.certificateReady ?? ""));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (body.certificateDelivered) {
    const result = await markCertificateDelivered(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  // The office re-sending any journey email (a lost invoice, a corrected detail) — forced past the once-only guard.
  if (body.resendStep) {
    const step = String(body.resendStep) as JourneyStep;
    if (!JOURNEY_ORDER.includes(step)) return NextResponse.json({ error: "Unknown email" }, { status: 400 });
    const result = await sendJourneyStep(id, step, { force: true });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
});
