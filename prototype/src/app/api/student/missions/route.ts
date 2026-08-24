import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { ensureTodayMissions } from "@/lib/daily-missions-server";

/**
 * Today's missions, and whether they're actually done.
 *
 * There used to be a POST here too: a student could send `{missionId, done:
 * true}` and the server would write it, no questions asked. That is not
 * gone because a checkbox is old-fashioned — it's gone because "done" now
 * means something (see mission-detection.ts), and the one thing that must
 * never decide whether a real record exists is the client that's asking.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const missions = await ensureTodayMissions(session.user.id as string);
  return NextResponse.json({ missions });
}
