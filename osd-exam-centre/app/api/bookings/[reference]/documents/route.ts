import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwnedBooking } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const { email, passportPhotoUrl, passportDataPageUrl } = await req.json();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!passportPhotoUrl && !passportDataPageUrl) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  await prisma.examBooking.update({
    where: { id: booking.id },
    data: {
      ...(passportPhotoUrl ? { passportPhotoUrl } : {}),
      ...(passportDataPageUrl ? { passportDataPageUrl } : {}),
      // A resubmission clears any prior rejection.
      documentStatus: "pending",
      documentRejectedReason: null,
    },
  });

  return NextResponse.json({ ok: true });
}
