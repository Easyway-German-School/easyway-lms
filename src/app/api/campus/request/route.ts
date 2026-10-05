import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import { loadCampusStudent, sendRequest } from "@/lib/campus-server";

export const dynamic = "force-dynamic";

/**
 * Send a wave, or a challenge — to one student who is online, or (for a
 * challenge) to anyone in the same age band who wants to play.
 *
 * Nothing here takes free text. A request is a kind and a target, and that is
 * all, so there is nothing for one student to type at another.
 */
export async function POST(request: Request) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { kind?: unknown; toUserId?: unknown } | null;
  const kind = body?.kind === "wave" || body?.kind === "duel" ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "Wave or duel?" }, { status: 400 });

  const toUserId = typeof body?.toUserId === "string" && body.toUserId ? body.toUserId : null;
  // A wave is personal; only a challenge can be an open call.
  if (kind === "wave" && !toUserId) return NextResponse.json({ error: "Who are you waving at?" }, { status: 400 });

  const me = await loadCampusStudent(auth.userId);
  if (!me) return NextResponse.json({ error: "Campus is for students." }, { status: 403 });
  if (!me.eligible) return NextResponse.json({ error: "Campus opens once your tuition is up to date." }, { status: 402 });

  const result = await sendRequest({ from: me, fromUserId: auth.userId, kind, toUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.id, duplicate: result.duplicate ?? false });
}
