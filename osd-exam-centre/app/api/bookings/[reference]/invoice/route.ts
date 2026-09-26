import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invoicePdfFor } from "@/lib/journey";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** A candidate re-downloading their own invoice/receipt — same reference-AND-email ownership rule as every other booking route. */
export const GET = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ reference: string }> }) => {
  const { reference } = await params;
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const booking = await prisma.examBooking.findUnique({ where: { referenceCode: reference }, include: { session: { include: { modulePrices: true } } } });
  if (!booking || booking.email !== email) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const pdf = await invoicePdfFor(booking);
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.filename}"`, "Cache-Control": "private, no-store" },
  });
});
