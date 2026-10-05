import { NextResponse } from "next/server";

import { campusSession } from "@/lib/campus-api";
import { duelFor, submitDuelAnswer } from "@/lib/campus-server";

export const dynamic = "force-dynamic";

/**
 * The duel as THIS player sees it: the eight words (never the articles of the
 * ones still to come), what they have answered so far, how far the other player
 * is, and the result once both are done. Also what the waiting screen polls.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const duel = await duelFor(auth.userId, id);
  if (!duel) return NextResponse.json({ error: "Duel not found" }, { status: 404 });
  return NextResponse.json(duel);
}

/** Answer the next word. The server scores it and says right or wrong. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await campusSession();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const body = (await request.json().catch(() => null)) as { i?: unknown; choice?: unknown; ms?: unknown } | null;
  const i = typeof body?.i === "number" && Number.isInteger(body.i) ? body.i : null;
  if (i === null) return NextResponse.json({ error: "Which word?" }, { status: 400 });
  const ms = typeof body?.ms === "number" ? body.ms : Number.NaN;

  const result = await submitDuelAnswer({ userId: auth.userId, duelId: id, i, choice: body?.choice, ms });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
