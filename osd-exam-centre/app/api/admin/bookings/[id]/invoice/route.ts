import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { invoicePdfFor } from "@/lib/journey";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** The office previews/downloads a candidate's invoice (or receipt, once paid). */
export const GET = jsonRoute(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const booking = await prisma.examBooking.findUnique({ where: { id }, include: { session: { include: { modulePrices: true } } } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const pdf = await invoicePdfFor(booking);
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.filename}"`, "Cache-Control": "private, no-store" },
  });
});
