import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { setGermanyGoal, loadJourney } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * "Why German?" — the answer, saved.
 *
 * The entire destination half of the map is generated from this one string, so
 * it is validated against the catalogue rather than trusted: an unknown id
 * would silently fall back to the generic road and the student would think
 * their answer had been ignored.
 *
 * It is CHANGEABLE, on purpose and forever. People's reasons change — an
 * au pair year becomes an Ausbildung, a study plan becomes a job — and a
 * portal that made somebody ring the branch to correct their own dream would
 * be a portal that ends up full of stale dreams.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const result = await setGermanyGoal(session.user.id, {
      goalId: typeof body?.goalId === "string" ? body.goalId : "",
      note: typeof body?.note === "string" ? body.note.slice(0, 400) : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Could not save that" }, { status: 400 });
    }

    const journey = await loadJourney(session.user.id);
    return NextResponse.json({ ok: true, journey });
  } catch (error) {
    console.error("Journey goal save failed", error);
    return NextResponse.json({ error: "Could not save your goal" }, { status: 500 });
  }
}
