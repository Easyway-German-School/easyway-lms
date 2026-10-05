import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import { ONLINE_WINDOW_MS, focusPhase } from "@/lib/campus";
import { awardCapped, loadCampusStudent } from "@/lib/campus-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";


/**
 * "I sat through a whole focus block in the Library" — pays a few coins.
 *
 * Honest about what it can check: the student must have been in the Library
 * within the last couple of minutes (their heartbeat says so), the block must
 * really have ended, and it must be a recent one — not a made-up cycle number
 * from next week. It cannot prove somebody was reading rather than scrolling,
 * which is why the reward is small and capped at four a day.
 */
export async function POST(request: Request) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { cycle?: unknown } | null;
  const cycle = typeof body?.cycle === "number" && Number.isInteger(body.cycle) ? body.cycle : null;
  if (cycle === null) return NextResponse.json({ error: "Which block?" }, { status: 400 });

  const now = Date.now();
  const current = focusPhase(now);
  // A block has ended once its cycle is over, or once we are in its break.
  const ended = cycle < current.cycle || (cycle === current.cycle && current.phase === "break");
  const recent = cycle >= current.cycle - 1;
  if (!ended || !recent) return NextResponse.json({ error: "That block isn't finished.", coins: 0 }, { status: 400 });

  const presence = await prisma.campusPresence.findUnique({ where: { userId: auth.userId } });
  const inLibrary = presence && presence.room === "library" && now - presence.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
  if (!inLibrary) return NextResponse.json({ error: "Stay in the Library to earn this.", coins: 0 }, { status: 400 });

  const me = await loadCampusStudent(auth.userId);
  if (!me?.eligible) return NextResponse.json({ error: "Campus is for students.", coins: 0 }, { status: 403 });

  const result = await awardCapped({ studentId: me.studentId, tenantId: me.tenantId, reason: "focus", extra: `c${cycle}` });
  return NextResponse.json({ coins: result.amount });
}
