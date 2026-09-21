import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liveWhere } from "@/lib/live-presence";
import { cohortRoomName } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

/**
 * "Is anything on air?" for the staff sidebars — one integer, no rows.
 *
 * The student portal already knows (`/api/live/state`, which also carries the
 * join code and the ringing state). Staff only need to know whether to light
 * the Live entry, so this is a single count:
 *
 *   admin    every class in session right now, school-wide — the same
 *            "genuinely live" definition the Live classes page uses
 *            (`liveWhere`: not ended, heartbeat fresh), so the glow and the
 *            list can never disagree.
 *   tutor    their own room, or any room they opened — the same match
 *            `/api/live/state` makes for a tutor.
 *
 * Anyone else (a student, a signed-out visitor) gets zero. Silence, not an
 * error: the shell polls this from every page.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ count: 0 });

    const role = String(session.user.role ?? "").toLowerCase();

    if (role === "admin") {
      const count = await prisma.liveClassSession.count({ where: liveWhere() });
      return NextResponse.json({ count });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      select: { id: true, level: true, sessionSlot: true, branch: { select: { name: true } } },
    });
    if (!lecturer) return NextResponse.json({ count: 0 });

    const room = cohortRoomName({
      branchName: lecturer.branch?.name,
      level: lecturer.level,
      sessionSlot: lecturer.sessionSlot,
    });
    const count = await prisma.liveClassSession.count({
      where: { OR: [{ roomName: room }, { lecturerId: lecturer.id }], ...liveWhere() },
    });
    return NextResponse.json({ count });
  } catch (error) {
    console.error("Live pulse lookup failed", error);
    // A failing poll must not light — or clear — a sidebar. Zero is the quiet answer.
    return NextResponse.json({ count: 0 });
  }
}
