import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwnedBooking } from "@/lib/booking";
import { bankTransferDetails } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  return NextResponse.json({ account: bankTransferDetails(), feeTotal: booking.feeTotal, paymentStatus: booking.paymentStatus });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const { email, transferProofUrl, transferReference } = await req.json();
  if (!email || !transferProofUrl) {
    return NextResponse.json({ error: "email and transferProofUrl are required" }, { status: 400 });
  }

  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.paymentStatus === "paid") {
    return NextResponse.json({ error: "This booking has already been paid for." }, { status: 409 });
  }

  await prisma.examBooking.update({
    where: { id: booking.id },
    data: {
      paymentMethod: "bank_transfer",
      paymentStatus: "pending_verification",
      transferProofUrl,
      transferReference: transferReference || null,
      transferRejectedReason: null,
    },
  });

  return NextResponse.json({ ok: true });
}
