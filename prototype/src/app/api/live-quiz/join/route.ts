import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePlayer } from "@/lib/live-quiz-views";
import { gameByPin, joinableGameForStudent, normalisePin } from "@/lib/live-quiz";

export const dynamic = "force-dynamic";

/**
 * Getting into the game.
 *
 * Two ways in, and both end at the same row. A student types the six digits off
 * the projector, or — when the game running belongs to their own class — taps
 * once and skips the typing. The second is not a replacement for the first: a
 * student sitting in a catch-up class, or one whose branch is not set, still
 * has the PIN, and the PIN is what a tutor reads out loud to a room.
 */

/** Is there a game my class is already playing? Polled by the join screen. */
export async function GET() {
  const player = await resolvePlayer();
  if (!player) return NextResponse.json({ game: null });

  const student = await prisma.student.findUnique({
    where: { id: player.studentId },
    select: { branchId: true, level: true, sessionSlot: true },
  });
  if (!student) return NextResponse.json({ game: null });

  const game = await joinableGameForStudent(student);
  if (!game) return NextResponse.json({ game: null });

  // Am I already in it? A student who reloads mid-game must land back in the
  // game rather than on a form asking for a PIN they have already used.
  const existing = await prisma.quizGamePlayer.findUnique({
    where: { gameId_studentId: { gameId: game.id, studentId: player.studentId } },
    select: { id: true },
  });

  return NextResponse.json({
    game: {
      id: game.id,
      title: game.title,
      phase: game.phase,
      joined: Boolean(existing),
    },
  });
}

export async function POST(request: NextRequest) {
  const player = await resolvePlayer();
  if (!player) {
    return NextResponse.json({ error: "Sign in with your student account to play" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  /**
   * By PIN, or by game id for the one-tap path. The id is accepted only after
   * the same joinability check the PIN goes through — an id is not a secret
   * (it is in the tutor's own markup) so it must not be a way past anything.
   */
  const pin = normalisePin(body?.pin);
  const gameId = String(body?.gameId ?? "");

  const game = pin
    ? await gameByPin(pin)
    : gameId
      ? await prisma.quizGame.findFirst({
          where: { id: gameId, endedAt: null },
          select: { id: true, title: true, phase: true, pin: true },
        })
      : null;

  if (!game) {
    return NextResponse.json(
      { error: "No game with that PIN. Check the screen and try again." },
      { status: 404 },
    );
  }

  /**
   * Latecomers are allowed in, and start on zero.
   *
   * The alternative — locking the doors once the first question is asked — is
   * how the third-party version behaves, and in a real classroom it means the
   * student whose phone would not connect for the first ninety seconds spends
   * the lesson watching. They cannot win from behind, but they can play, and
   * playing is the point. The one closed door is a game that is over.
   */
  if (game.phase === "ended") {
    return NextResponse.json({ error: "That game has finished." }, { status: 410 });
  }

  await prisma.quizGamePlayer.upsert({
    where: { gameId_studentId: { gameId: game.id, studentId: player.studentId } },
    // Rejoining is not a reset. A phone that lost wifi and came back must find
    // its score where it left it, or every dropped connection is a punishment.
    update: { lastSeenAt: new Date() },
    create: { gameId: game.id, studentId: player.studentId },
  });

  return NextResponse.json({ game: { id: game.id, title: game.title, phase: game.phase } });
}
