import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { claimStage, loadJourney } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * The stages after the classroom — exam, documents, visa, arrival.
 *
 * The school does not run the embassy, so these are the student's word. Stored
 * as a claim, visible to the office, and undoable: somebody who taps "I have my
 * visa" a fortnight early must be able to take it back without ringing anyone.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const stage = typeof body?.stage === "string" ? body.stage : "";

    const result = await claimStage(session.user.id, {
      stage,
      note: typeof body?.note === "string" ? body.note.slice(0, 500) : null,
      undo: body?.undo === true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Could not save that" }, { status: 400 });
    }

    const journey = await loadJourney(session.user.id);
    return NextResponse.json({ ok: true, journey });
  } catch (error) {
    console.error("Journey stage claim failed", error);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}
