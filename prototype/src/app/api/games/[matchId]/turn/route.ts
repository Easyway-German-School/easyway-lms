import { NextResponse, type NextRequest } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";
import { submitTurn } from "@/lib/satzkette-server";
import { MAX_SENTENCE_CHARS } from "@/lib/satzkette";

export const dynamic = "force-dynamic";

/** Write the sentence. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const userId = session.user.id as string;
  const role = (session.user as { role?: string }).role ?? "STUDENT";
  const { matchId } = await params;

  const body = await request.json().catch(() => ({}));
  const turnId = String(body?.turnId ?? "");
  const sentence = String(body?.sentence ?? "");

  if (!turnId) return NextResponse.json({ error: "Which turn?" }, { status: 400 });

  // Cut absurd payloads before they reach the rules, so a pasted essay is a
  // 400 rather than a row this school has to store.
  if (sentence.length > MAX_SENTENCE_CHARS * 4) {
    return NextResponse.json({ error: "That is far too long for one turn." }, { status: 400 });
  }

  const match = await prisma.gameMatch.findUnique({
    where: { id: matchId },
    select: { id: true, spaceId: true },
  });
  if (!match) return NextResponse.json({ error: "No such story" }, { status: 404 });

  const scope = await resolveSpaceScope({ userId, role });
  if (!match.spaceId || !scope.spaceIds.includes(match.spaceId)) {
    return NextResponse.json({ error: "That story is not yours to write in" }, { status: 403 });
  }

  // Checked against the match in the URL as well as the id in the body: without
  // this, a turn id from another cohort's story would pass the membership check
  // above on the strength of a matchId the caller does belong to.
  const turn = await prisma.gameTurn.findUnique({
    where: { id: turnId },
    select: { matchId: true },
  });
  if (!turn || turn.matchId !== match.id) {
    return NextResponse.json({ error: "That turn is not in this story" }, { status: 400 });
  }

  const result = await submitTurn({ turnId, userId, sentence });

  if (!result.ok) {
    // 409 rather than 400 for a lost race: the sentence was fine, somebody else
    // was simply faster, and the page shows that differently.
    const lostRace = result.problem.startsWith("Somebody just took");
    return NextResponse.json({ error: result.problem }, { status: lostRace ? 409 : 400 });
  }

  return NextResponse.json({
    ok: true,
    matchCompleted: result.matchCompleted,
  });
}
