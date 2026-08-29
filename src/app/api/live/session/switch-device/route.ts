import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { sendPushToUsers } from "@/lib/push";

/**
 * "Continue this class on another device."
 *
 * Pushes a plain link to `/live` to every device this person has push
 * enabled on. Nothing about the room is looked up here — `/live` always
 * resolves "whichever class I'm in right now" from the signed-in identity,
 * so this route only needs to know who asked. Opening it on the new device
 * connects a second LiveKit participant under the same identity, which is
 * what makes the first device step aside gracefully instead of being kicked.
 */
export async function POST() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await sendPushToUsers([session.user.id], {
    title: "Continue your class",
    body: "Tap to pick up where you left off, right here.",
    url: "/live",
    tag: "live-switch",
  });

  return NextResponse.json({ sent: result.sent });
}
