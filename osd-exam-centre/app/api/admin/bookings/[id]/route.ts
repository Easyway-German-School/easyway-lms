import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { cancelBooking, confirmBookingPayment, markNoShow, rejectBookingPayment, reviewBookingDocuments } from "@/lib/booking";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** One admin action per call: verify/reject the transfer, approve/reject documents, cancel, or mark a no-show. */
export const PATCH = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { transferAction, transferRejectReason, documentAction, documentRejectReason, cancelReason, markNoShow: shouldMarkNoShow } = await req.json();

  if (cancelReason !== undefined) {
    const result = await cancelBooking(id, String(cancelReason || "Cancelled by the office."));
    return NextResponse.json({ ok: true, ...result });
  }
  if (shouldMarkNoShow) {
    await markNoShow(id);
    return NextResponse.json({ ok: true });
  }

  if (transferAction === "verify") {
    // Admin identity here is deliberately "the office" (see lib/admin-auth.ts)
    // — this app has one shared password, not per-person accounts.
    const result = await confirmBookingPayment(id, "office");
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

  return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
});
