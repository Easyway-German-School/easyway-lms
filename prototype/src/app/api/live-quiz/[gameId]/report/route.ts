import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quizReport } from "@/lib/live-quiz-views";
import { resolveHost } from "@/lib/live-quiz-views";

export const dynamic = "force-dynamic";

/**
 * How the class did, after the room has emptied.
 *
 * Staff only, and scoped: a tutor reads their OWN games. This carries every
 * student's name and score in one payload, so "any signed-in tutor" would be a
 * neat way to export another cohort's marks. An admin sees all of them, the
 * same rule the quiz list itself follows.
 */
export async function GET(_request: Request, context: { params: Promise<{ gameId: string }> }) {
  const host = await resolveHost();
  if (!host) return NextResponse.json({ error: "Staff access required" }, { status: 403 });

  const { gameId } = await context.params;

  const owner = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: { hostUserId: true, lecturerId: true },
  });
  if (!owner) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const mine =
    owner.hostUserId === host.userId ||
    (host.lecturerId !== null && owner.lecturerId === host.lecturerId);
  if (!mine && !host.isAdmin) {
    return NextResponse.json({ error: "That is not one of your games" }, { status: 403 });
  }

  const report = await quizReport(gameId);
  if (!report) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  return NextResponse.json(report);
}
