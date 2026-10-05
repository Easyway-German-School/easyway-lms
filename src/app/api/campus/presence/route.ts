import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import { isPresenceRoom, summariseCampus } from "@/lib/campus";
import { heartbeat, onlineInBand, requestsForMe } from "@/lib/campus-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * "I'm here" — and, when the Campus screen asks for it, "show me who else is".
 *
 * ONE endpoint for both on purpose. The whole portal sends a tiny heartbeat
 * every ~90 seconds while the app is visible (`full: false` — a few bytes
 * back). The Campus screen sends the same call every ~30 seconds with
 * `full: true` and gets the picture back in the same response, so a student
 * watching the campus costs one request per half minute, not two.
 *
 * Reads go through a per-(school, age band) snapshot cached in the server's
 * memory for ten seconds — see onlineInBand. The viewer's band comes from their
 * own presence row, never from the request, so nobody can ask for another
 * band's picture.
 */
export async function POST(request: Request) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { room?: unknown; hidden?: unknown; full?: unknown };
  const room = isPresenceRoom(body.room) ? body.room : "lobby";
  const hidden = typeof body.hidden === "boolean" ? body.hidden : undefined;

  const result = await heartbeat(auth.userId, room, hidden);
  if (!result.ok) {
    // Not an error the student caused: Campus simply isn't theirs (yet), or is switched off.
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.reason === "not_student" ? 403 : 200 });
  }

  if (body.full !== true) {
    return NextResponse.json({ ok: true, incoming: result.incoming, balance: result.balance, hidden: result.hidden });
  }

  const people = await onlineInBand(result.tenantId, result.band);
  const [requests, mine] = await Promise.all([
    requestsForMe(auth.userId, result.tenantId, result.band),
    // One tiny read so the coin chip is always right, not just on the first visit of the day.
    prisma.student.findUnique({ where: { userId: auth.userId }, select: { coinBalance: true } }),
  ]);
  const snapshot = summariseCampus(people, auth.userId);

  return NextResponse.json({
    ok: true,
    incoming: result.incoming,
    balance: mine?.coinBalance ?? result.balance,
    hidden: result.hidden,
    snapshot,
    requests,
  });
}
