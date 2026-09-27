import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { settleCardPayment } from "@/lib/booking";
import { siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Where Flutterwave sends the candidate's browser back to after a card
 * attempt (redirect_url in initiateCardPayment). Not the source of truth by
 * itself — the webhook (../webhook/route.ts) settles the same booking if the
 * candidate closes the tab before this loads — but it's what lets someone
 * who stays on the page see their seat immediately instead of waiting on a
 * webhook that might take a few seconds.
 */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const transactionId = req.nextUrl.searchParams.get("transaction_id");
  const txRef = req.nextUrl.searchParams.get("tx_ref");

  const fallback = new URL("/status", siteUrl());

  try {
    if (!transactionId) {
      return NextResponse.redirect(fallback);
    }

    if (status !== "successful") {
      // Cancelled or failed — find the booking from tx_ref's bookingId segment
      // isn't reliable (see the comment on tx_ref format in lib/payments.ts),
      // so send them to /status rather than guess which booking this was.
      return NextResponse.redirect(new URL(`/status?paymentCancelled=1`, siteUrl()));
    }

    const result = await settleCardPayment(transactionId);
    if (!result.ok) {
      console.error("Card payment settlement failed:", result.error, { transactionId, txRef });
      return NextResponse.redirect(new URL(`/status?paymentError=1`, siteUrl()));
    }

    const booking = await prisma.examBooking.findUnique({
      where: { id: result.bookingId },
      select: { referenceCode: true, email: true },
    });
    if (!booking) return NextResponse.redirect(fallback);

    return NextResponse.redirect(
      new URL(`/booking/${booking.referenceCode}?email=${encodeURIComponent(booking.email)}`, siteUrl()),
    );
  } catch (error) {
    // A browser lands here mid-navigation, not via fetch — a JSON 500 would
    // just render as raw text. Redirecting to /status keeps this landing
    // somewhere useful even when something unexpected breaks.
    console.error("Card payment callback failed:", error, { transactionId, txRef });
    return NextResponse.redirect(new URL(`/status?paymentError=1`, siteUrl()));
  }
}
