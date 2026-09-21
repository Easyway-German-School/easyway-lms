import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { typingFeedFor } from "@/lib/community-typing";

export const dynamic = "force-dynamic";

/**
 * "WHO IS TYPING, ANYWHERE IN MY CLASS CHAT?" — one small poll for the whole
 * portal.
 *
 * Drives the floating "Anna is typing in General" pill, the live dots on the
 * community button and the "is typing…" line on each room in the room list.
 * Students and tutors only: for the office it answers `enabled: false` without
 * touching the database (see typingFeedFor).
 *
 * Deliberately a separate endpoint from /api/portal/updates. That one re-checks
 * the viewer's rooms and carries message text every eight seconds; typing needs
 * to be fresher than that to feel alive (a ping only lives seven seconds), and
 * bolting a faster cadence onto the heavier endpoint would multiply its cost.
 * This one is a single indexed read on a warm instance.
 *
 * A failure is a 200 with nothing in it — it runs on a timer for as long as a
 * tab is open, and a 500 here would fill every console in the school.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ enabled: false, rooms: [] });

  try {
    const feed = await typingFeedFor({
      userId: session.user.id as string,
      role: String((session.user as any).role ?? ""),
    });
    return NextResponse.json(feed);
  } catch (error) {
    console.error("Community typing feed failed:", error);
    return NextResponse.json({ enabled: true, rooms: [] });
  }
}
