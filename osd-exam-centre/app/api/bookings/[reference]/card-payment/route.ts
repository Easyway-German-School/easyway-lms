import { NextRequest, NextResponse } from "next/server";
import { resolveOwnedBooking } from "@/lib/booking";
import { cardPaymentsEnabled, initiateCardPayment } from "@/lib/payments";
import { siteUrl } from "@/lib/config";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** Start a Flutterwave checkout for a candidate paying from outside Nigeria. */
export const POST = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ reference: string }> }) => {
  if (!cardPaymentsEnabled()) {
    return NextResponse.json({ error: "Card payments are not available right now — please pay by bank transfer." }, { status: 503 });
  }

  const { reference } = await params;
  const { email } = await req.json().catch(() => ({ email: null }));
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.paymentStatus === "paid") {
    return NextResponse.json({ error: "This booking has already been paid for." }, { status: 409 });
  }

  const result = await initiateCardPayment(booking, `${siteUrl()}/api/card-payment/callback`);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({ paymentLink: result.paymentLink });
});
