import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { clampSince, loadPortalUpdates } from "@/lib/portal-updates";

export const dynamic = "force-dynamic";

/**
 * EVERYTHING THAT SHOULD INTERRUPT SOMEBODY, IN ONE POLL.
 *
 * One endpoint rather than three, and that is a deliberate cost decision. This
 * is polled by every signed-in browser on every page for the whole time the
 * portal is open. Three endpoints would be three sets of auth, three tenant
 * resolutions and three round trips on connections that cannot spare one.
 *
 * WHY POLLING AND NOT SSE, historically. Server-sent events would be the
 * elegant answer and were the wrong one here: this deploys to Vercel, where a
 * function has a hard execution ceiling, so a held-open stream is killed and
 * reconnected on a timer anyway. That is still true for THIS route, which is
 * why it still polls — but see push-server/server.ts and PushUpdates.ts for
 * the self-hosted alternative this project is building: loadPortalUpdates
 * below is shared by both, so a client that can reach the push server gets
 * the same data over a real connection instead of asking for it every few
 * seconds.
 *
 * The client sends `since`, the timestamp it last heard about. Everything newer
 * comes back WITH ITS TEXT — the entire point of the feature is that the popup
 * shows what was actually said, so a payload of ids and counts would miss it.
 */
export async function GET(request: Request) {
  const session = await requireAuthSession();
  // Signed out is not an error worth logging — it is a tab somebody left open.
  if (!session?.user?.id) return NextResponse.json({ updates: [], unread: 0, now: new Date().toISOString() });

  const userId = session.user.id as string;
  const now = new Date();

  try {
    const sinceParam = request.url ? new URL(request.url).searchParams.get("since") : null;
    const since = clampSince(sinceParam, now);
    const result = await loadPortalUpdates({ userId, role: (session.user as any).role, since });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Portal updates poll failed:", error);
    // Deliberately a 200 with nothing in it. This runs on a timer forever; a
    // 500 here would fill the console of every open tab in the school.
    return NextResponse.json({ updates: [], unread: 0, now: now.toISOString() });
  }
}
