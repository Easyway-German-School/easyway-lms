import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { confirmStart, deferStart, loadJourney } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * The one button the whole feature turns on.
 *
 * `{ started: true }`  — their two months begin, from the date they give.
 * `{ started: false }` — the question moves to tomorrow, and the reason is kept
 *                        because it is the only churn signal the school has.
 *
 * Both answers return the freshly rebuilt journey, so the map re-draws with the
 * countdown already running rather than making the client fetch twice and show
 * a stale road in between.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const started = body?.started === true;

    if (started) {
      const result = await confirmStart(session.user.id, {
        startedOn: typeof body?.startedOn === "string" ? body.startedOn : null,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      const journey = await loadJourney(session.user.id);
      return NextResponse.json({ started: true, startedOn: result.startedOn, message: result.message, journey });
    }

    const deferred = await deferStart(session.user.id, {
      reason: typeof body?.reason === "string" ? body.reason : null,
    });
    const journey = await loadJourney(session.user.id);
    return NextResponse.json({
      started: false,
      askAgainOn: deferred.askAgainOn,
      message: deferred.reply,
      journey,
    });
  } catch (error) {
    console.error("Journey confirmation failed", error);
    return NextResponse.json({ error: "Could not record that" }, { status: 500 });
  }
}
