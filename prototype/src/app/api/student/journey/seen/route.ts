import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { markMomentSeen } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * "Shown today."
 *
 * Server-side rather than localStorage, because a student who met the map on a
 * laptop at 9am should not meet it again on their phone at noon — the same
 * lesson the welcome tour learned when it moved its stamp onto the Student row.
 */
export async function POST() {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await markMomentSeen(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Journey seen stamp failed", error);
    // Failing to stamp costs one extra showing, not correctness.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
