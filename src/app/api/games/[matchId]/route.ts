import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";
import {
  assembleStory,
  canPlay,
  constraintLabel,
  effectiveState,
  isCheckable,
  parseConstraint,
} from "@/lib/satzkette";

export const dynamic = "force-dynamic";

/** One story: everything written so far, and the turn that is open now. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to read this" }, { status: 401 });
  }

  const userId = session.user.id as string;
  const role = (session.user as { role?: string }).role ?? "STUDENT";
  const { matchId } = await params;

  const match = await prisma.gameMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      spaceId: true,
      title: true,
      prompt: true,
      status: true,
      targetTurns: true,
      completedAt: true,
      turns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          sentence: true,
          playerId: true,
          assignedToId: true,
          status: true,
          deadline: true,
          submittedAt: true,
          constraint: true,
          player: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      },
    },
  });

  if (!match) return NextResponse.json({ error: "No such story" }, { status: 404 });

  // Membership is the read check. A story is a transcript of one cohort's
  // students by name, so it is exactly as private as their group chat.
  const scope = await resolveSpaceScope({ userId, role });
  if (!match.spaceId || !scope.spaceIds.includes(match.spaceId)) {
    return NextResponse.json({ error: "That story is not yours to read" }, { status: 403 });
  }

  const story = assembleStory(match.turns);
  const live = match.turns.find((turn) => !turn.submittedAt) ?? null;
  const constraint = live ? parseConstraint(live.constraint) : null;

  return NextResponse.json({
    match: {
      id: match.id,
      title: match.title,
      prompt: match.prompt,
      status: match.status,
      targetTurns: match.targetTurns,
      completedAt: match.completedAt,
    },
    story,
    currentTurn: live
      ? {
          id: live.id,
          position: live.position,
          state: effectiveState(live),
          // The name is shown while the turn is still exclusive, so the class
          // can see who they are waiting on. That visibility is the social
          // pressure the whole mechanic runs on.
          assignedToName: live.assignedTo?.name ?? "A classmate",
          isMine: live.assignedToId === userId,
          canPlay: canPlay(live, userId),
          deadline: live.deadline,
          rule: constraint ? constraintLabel(constraint) : null,
          // Tells the writer whether the rule will be checked or is guidance
          // the tutor reads later — a promise this app should not fake.
          ruleChecked: constraint ? isCheckable(constraint) : false,
        }
      : null,
  });
}
