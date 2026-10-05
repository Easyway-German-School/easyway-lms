import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import { loadCampusStudent, myRequestOutcome, respondToRequest } from "@/lib/campus-server";

export const dynamic = "force-dynamic";

/** The sender asks "did anybody take my challenge yet?" — answered with the duel to jump into. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const outcome = await myRequestOutcome(auth.userId, id);
  if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(outcome);
}

/** Accept or decline a request aimed at you, take an open call, or cancel one of your own. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action === "accept" || body?.action === "decline" || body?.action === "cancel" ? body.action : null;
  if (!action) return NextResponse.json({ error: "Accept, decline or cancel?" }, { status: 400 });

  const me = await loadCampusStudent(auth.userId);
  if (!me) return NextResponse.json({ error: "Campus is for students." }, { status: 403 });
  if (!me.eligible) return NextResponse.json({ error: "Campus opens once your tuition is up to date." }, { status: 402 });

  const result = await respondToRequest({ me, userId: auth.userId, requestId: id, action });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, duelId: result.duelId ?? null });
}
