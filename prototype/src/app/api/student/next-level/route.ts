import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { loadJourney, loadJourneyStudent, markSeen, holdSeat } from "@/lib/next-level-journey-server";

export const dynamic = "force-dynamic";

/**
 * The student's own next-level journey: what they did, what is next, where
 * they stand. Read-only except for two things they say themselves — "I opened
 * it" and "keep my seat" — which only ever write to their own record.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const student = await loadJourneyStudent({ userId: session.user.id });
    if (!student) return NextResponse.json({ journey: null });

    const journey = await loadJourney(student);
    return NextResponse.json({ journey });
  } catch (error) {
    console.error("next-level GET failed", error);
    // A broken lookup must never break the dashboard it is shown on.
    return NextResponse.json({ journey: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (action !== "seen" && action !== "hold") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const student = await loadJourneyStudent({ userId: session.user.id });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    // Re-derive the audience on the server; the browser never says which level
    // it is asking about.
    const journey = await loadJourney(student);
    if (!journey) {
      return NextResponse.json({ error: "There is no next level open for you right now." }, { status: 409 });
    }

    if (action === "seen") {
      await markSeen(student, journey.audience.targetLevel);
      return NextResponse.json({ ok: true });
    }

    const intent = await holdSeat(student, journey.audience, body?.details);
    return NextResponse.json({ ok: true, intent });
  } catch (error) {
    console.error("next-level POST failed", error);
    return NextResponse.json({ error: "Could not save that. Please try again." }, { status: 500 });
  }
}
