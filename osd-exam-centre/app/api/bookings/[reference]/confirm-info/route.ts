import { NextRequest, NextResponse } from "next/server";
import { resolveOwnedBooking } from "@/lib/booking";
import { confirmInfo } from "@/lib/lifecycle";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** "My details are correct" — Document C's call to action. */
export const POST = jsonRoute(async (req: NextRequest, { params }: { params: Promise<{ reference: string }> }) => {
  const { reference } = await params;
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  const booking = await resolveOwnedBooking(reference, email);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const result = await confirmInfo(booking.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
