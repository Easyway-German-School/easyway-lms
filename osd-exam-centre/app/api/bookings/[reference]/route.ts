import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Status lookup — reference code AND email, both. The reference code alone
 * is already high-entropy (32^5 ≈ 33M combinations), but requiring the email
 * too costs the candidate nothing (they typed it at booking) and means a
 * leaked/guessed reference on its own reveals nothing.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const booking = await prisma.examBooking.findUnique({
    where: { referenceCode: reference },
    include: { session: true },
  });
  if (!booking || booking.email !== email) {
    return NextResponse.json({ error: "No booking found with that reference and email." }, { status: 404 });
  }

  return NextResponse.json({ booking: shapeBooking(booking) });
}

export function shapeBooking(booking: NonNullable<Awaited<ReturnType<typeof prisma.examBooking.findUnique>>> & {
  session: NonNullable<Awaited<ReturnType<typeof prisma.examSession.findUnique>>>;
}) {
  return {
    referenceCode: booking.referenceCode,
    fullName: booking.fullName,
    email: booking.email,
    modules: booking.modules,
    feeTotal: booking.feeTotal,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    transferRejectedReason: booking.transferRejectedReason,
    passportPhotoUrl: booking.passportPhotoUrl,
    passportDataPageUrl: booking.passportDataPageUrl,
    documentStatus: booking.documentStatus,
    documentRejectedReason: booking.documentRejectedReason,
    seatNumber: booking.seatNumber,
    status: booking.status,
    session: {
      title: booking.session.title,
      level: booking.session.level,
      venueName: booking.session.venueName,
      venueAddress: booking.session.venueAddress,
      startDate: booking.session.startDate,
      endDate: booking.session.endDate,
    },
  };
}
