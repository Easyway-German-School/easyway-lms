import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { isSmsConfigured, normalizeNigerianPhone, sendSms } from "@/lib/sms";

/**
 * "Does SMS actually work?" — sent INLINE, not queued, so the admin gets
 * Termii's real answer in the same request instead of having to go check a
 * queue table. This is the only place in the app that calls `sendSms`
 * directly rather than through sms-queue.ts, because the whole point here is
 * an immediate, honest yes/no — a queued send would report "queued" and
 * leave the admin no better informed than before they clicked the button.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  if (!isSmsConfigured()) {
    return NextResponse.json({ error: "TERMII_API_KEY is not set — nothing to test yet." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const phone = normalizeNigerianPhone(typeof body?.phone === "string" ? body.phone : "");
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a Nigerian phone number." }, { status: 400 });
  }

  const result = await sendSms({
    to: phone,
    message: "EasyWay LMS: this is a test message confirming SMS delivery is working. You can ignore this.",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Termii did not confirm delivery." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: phone });
}
