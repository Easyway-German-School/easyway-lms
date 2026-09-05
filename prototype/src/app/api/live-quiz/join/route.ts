import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePlayer } from "@/lib/live-quiz-views";
import { assignTeam, gameByPin, joinableGameForStudent, normalisePin } from "@/lib/live-quiz";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor, receivedPaymentFilter } from "@/lib/payment";

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
    select: {
      branchId: true,
      level: true,
      sessionSlot: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
    },
  });
  if (!student) return NextResponse.json({ game: null });

  const tuitionFee = tuitionFeeFor({ level: student.level, branch: student.branch?.name, classType: student.classType, pathway: student.pathway });
  const payment = derivePaymentStatus({
    totalPaid: student.payments.reduce((sum, row) => sum + row.amount, 0),
    tuitionFee,
    requiredDeposit: requiredDepositFor({ level: student.level, branch: student.branch?.name, classType: student.classType, pathway: student.pathway }),
  });
  if (!payment.depositPaid) return NextResponse.json({ game: null, locked: true });

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

  const student = await prisma.student.findUnique({
    where: { id: player.studentId },
    select: {
      level: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });
  const tuitionFee = tuitionFeeFor({ level: student.level, branch: student.branch?.name, classType: student.classType, pathway: student.pathway });
  const payment = derivePaymentStatus({
    totalPaid: student.payments.reduce((sum, row) => sum + row.amount, 0),
    tuitionFee,
    requiredDeposit: requiredDepositFor({ level: student.level, branch: student.branch?.name, classType: student.classType, pathway: student.pathway }),
  });
  if (!payment.depositPaid) {
    return NextResponse.json({ error: "Pay your tuition deposit to unlock the quiz game.", locked: true }, { status: 402 });
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
          select: { id: true, title: true, phase: true, pin: true, teamMode: true },
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

  /**
   * A team, in a team game, decided HERE and not by the student.
   *
   * Counted at join time rather than balanced afterwards, so a class arriving
   * one phone at a time still ends up even — see `assignTeam`. Only computed
   * for a team game: a solo game leaves the column null, which is what null
   * means on that row.
   */
  let team: string | null = null;
  if (game.teamMode) {
    const grouped = await prisma.quizGamePlayer.groupBy({
      by: ["team"],
      where: { gameId: game.id },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of grouped) {
      if (row.team) counts[row.team] = row._count._all;
    }
    team = assignTeam(counts);
  }

  await prisma.quizGamePlayer.upsert({
    where: { gameId_studentId: { gameId: game.id, studentId: player.studentId } },
    // Rejoining is not a reset. A phone that lost wifi and came back must find
    // its score where it left it, or every dropped connection is a punishment —
    // and it must keep the TEAM it was on, or a reconnect quietly moves somebody
    // between sides mid-game.
    update: { lastSeenAt: new Date() },
    create: { gameId: game.id, studentId: player.studentId, team },
  });

  return NextResponse.json({ game: { id: game.id, title: game.title, phase: game.phase } });
}
