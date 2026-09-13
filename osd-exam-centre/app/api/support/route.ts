import { NextRequest, NextResponse } from "next/server";
import { submitSupportMessage } from "@/lib/support";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** Public: "Need help?" from anywhere — the booking page, the printed slip, or before registering at all. */
export const POST = jsonRoute(async (req: NextRequest) => {
  const { bookingReference, name, email, message } = await req.json().catch(() => ({}));
  const result = await submitSupportMessage({ bookingReference: bookingReference || null, name, email, message });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
