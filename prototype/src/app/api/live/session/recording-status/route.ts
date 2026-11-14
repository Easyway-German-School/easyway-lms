import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * "Is this class being recorded right now?" — for the badge on the stage.
 *
 * The self-hosted recorder joins as a HIDDEN participant, so a student's or
 * tutor's browser cannot see it, and LiveKit's own `room.isRecording` only
 * covers LiveKit Egress. The `ClassRecording` row is the one record both
 * backends keep, and it is what the admin recorder screen already reads, so
 * the classroom asks the same question here instead of guessing.
 */
export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const liveSessionId = new URL(request.url).searchParams.get("liveSessionId") ?? "";
  if (!liveSessionId) return NextResponse.json({ error: "liveSessionId is required" }, { status: 400 });

  try {
    const live = await prisma.liveClassSession.findUnique({
      where: { id: liveSessionId },
      select: { roomName: true },
    });
    if (!live) return NextResponse.json({ recording: false });

    const active = await prisma.classRecording.findFirst({
      where: { roomName: live.roomName, status: { in: ["active", "restarting"] } },
      select: { startedAt: true },
      orderBy: { startedAt: "desc" },
    });
    return NextResponse.json(
      { recording: Boolean(active), since: active?.startedAt?.toISOString() ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("recording-status failed", error);
    return NextResponse.json({ recording: null });
  }
}
