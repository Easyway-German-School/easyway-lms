import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { loadLiveState } from "@/lib/live-state";

export const dynamic = "force-dynamic";

/**
 * "Is my class live right now?" — the one question the portal could not answer.
 *
 * Thin wrapper over loadLiveState (src/lib/live-state.ts), shared with the
 * self-hosted push server so a connected browser can get this over its
 * WebSocket instead of polling here — see push-server/server.ts.
 *
 * It returns no token and no room credentials. Knowing a class has started
 * is not the same as being let into it, and only /api/live/session mints keys.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      // Not an error worth logging or surfacing — the shell polls this from
      // pages a signed-out visitor can reach. Silence is the right answer.
      return NextResponse.json({ live: null });
    }

    const result = await loadLiveState(session.user.id as string);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Live state lookup failed", error);
    // A failing poll must never put an error banner on a page the student is
    // reading. "Nothing is live" is the safe, quiet answer.
    return NextResponse.json({ live: null });
  }
}
