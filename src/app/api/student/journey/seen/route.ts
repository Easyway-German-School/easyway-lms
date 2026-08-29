import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { markMomentSeen } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * "Shown today."
 *
 * Server-side rather than localStorage, because a student who met the map on a
 * laptop at 9am should not meet it again on their phone at noon — the same
 * lesson the welcome tour learned when it moved its stamp onto the Student row.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The body is optional. Closing the map normally sends nothing and just
    // stamps the day; the three frequency buttons send a preference with the
    // same request, so choosing "show less" cannot half-apply.
    const body = await request.json().catch(() => ({}));
    const preference = typeof body?.preference === "string" ? body.preference : undefined;

    await markMomentSeen(session.user.id, preference);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Journey seen stamp failed", error);
    // Failing to stamp costs one extra showing, not correctness.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
