import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseQuestions } from "@/lib/assignments";
import { hostView, playerView, resolveHost, resolvePlayer } from "@/lib/live-quiz-views";

export const dynamic = "force-dynamic";

/**
 * The one endpoint every screen in the game reads, and the one the tutor drives
 * it with.
 *
 * GET is role-aware: the projector and the phone ask the same URL and are told
 * different things, because the difference between them is a security boundary
 * and not a rendering choice. See src/lib/live-quiz-views.ts.
 */

export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;

  // Staff first: a tutor is never also a player, and checking in this order
  // means an admin who happens to have a student row still gets the projector.
  const host = await resolveHost();
  if (host) {
    const view = await hostView(gameId);
    if (!view) return NextResponse.json({ error: "Game not found" }, { status: 404 });
    return NextResponse.json(view);
  }

  const player = await resolvePlayer();
  if (!player) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const view = await playerView(gameId, player.studentId);
  // Null here means signed in but not in this game — which is what a student
  // who opened somebody else's link looks like, and they are told to use a PIN
  // rather than shown a room they are not in.
  if (!view) return NextResponse.json({ error: "You have not joined this game" }, { status: 403 });

  return NextResponse.json(view);
}

/* -------------------------------------------------------------------------- */
/* Driving the game                                                           */
/* -------------------------------------------------------------------------- */

const ACTIONS = ["start", "lock", "reveal", "standings", "next", "end"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Every transition, in one place, guarded by the phase it is legal from.
 *
 * The guards are not defensive programming for its own sake. The host screen
 * fires `reveal` automatically when its countdown hits zero AND when the last
 * student answers, and those two things can happen in the same half-second. An
 * ungurded `reveal` fired twice would advance the game two steps, so the class
 * would watch a question they never saw the answer to.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;

  const host = await resolveHost();
  if (!host) return NextResponse.json({ error: "Staff access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "") as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const game = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      phase: true,
      currentIndex: true,
      questions: true,
      secondsPerQuestion: true,
      hostUserId: true,
      startedAt: true,
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  /**
   * Only the person running the game may drive it — an admin included, because
   * somebody has to be able to end a game whose host has gone home. Another
   * tutor in the same school is staff and would still be refused: two people
   * pressing next on one projector is the classroom equivalent of two hands on
   * one steering wheel.
   */
  if (game.hostUserId !== host.userId && !host.isAdmin) {
    return NextResponse.json({ error: "Somebody else is running this game" }, { status: 403 });
  }

  const questions = parseQuestions(game.questions);
  const now = new Date();

  const openQuestion = (index: number) => ({
    phase: "question",
    currentIndex: index,
    questionStartedAt: now,
    questionEndsAt: new Date(now.getTime() + game.secondsPerQuestion * 1000),
    ...(game.startedAt ? {} : { startedAt: now }),
  });

  switch (action) {
    case "start": {
      if (game.phase !== "lobby") break;
      if (questions.length === 0) {
        return NextResponse.json({ error: "This game has no questions" }, { status: 400 });
      }
      await prisma.quizGame.update({ where: { id: gameId }, data: openQuestion(0) });
      break;
    }

    /**
     * Stop the clock early. The tutor can see the room; when the last head
     * comes up there is no reason to make everyone watch eight more seconds
     * tick away, and dead air is where a game-show loses a class.
     *
     * It moves the buzzer rather than changing the phase, so every scoring rule
     * downstream still works off `questionEndsAt` and nothing needs to know
     * this happened.
     */
    case "lock": {
      if (game.phase !== "question") break;
      await prisma.quizGame.update({ where: { id: gameId }, data: { questionEndsAt: now } });
      break;
    }

    case "reveal": {
      if (game.phase !== "question") break;
      await prisma.quizGame.update({
        where: { id: gameId },
        data: { phase: "reveal", questionEndsAt: now },
      });
      /**
       * Silence breaks a streak.
       *
       * A student who stops answering must not keep their multiplier warm for
       * when they come back — the streak is a reward for a run of right
       * answers, and treating "said nothing" as neutral would make sitting out
       * the hard questions the optimal way to play.
       */
      await prisma.quizGamePlayer.updateMany({
        where: {
          gameId,
          streak: { gt: 0 },
          answers: { none: { questionIndex: game.currentIndex } },
        },
        data: { streak: 0 },
      });
      break;
    }

    case "standings": {
      if (game.phase !== "reveal") break;
      await prisma.quizGame.update({ where: { id: gameId }, data: { phase: "standings" } });
      break;
    }

    case "next": {
      if (game.phase !== "reveal" && game.phase !== "standings") break;
      const nextIndex = game.currentIndex + 1;
      if (nextIndex >= questions.length) {
        await prisma.quizGame.update({
          where: { id: gameId },
          data: { phase: "ended", endedAt: now, questionEndsAt: null },
        });
        break;
      }
      await prisma.quizGame.update({ where: { id: gameId }, data: openQuestion(nextIndex) });
      break;
    }

    case "end": {
      if (game.phase === "ended") break;
      await prisma.quizGame.update({
        where: { id: gameId },
        data: { phase: "ended", endedAt: now, questionEndsAt: null },
      });
      break;
    }
  }

  // The updated view comes back with the action, so the projector repaints on
  // the click instead of on the next poll. A button with up to a second of
  // nothing after it reads as broken, and this one is pressed in front of
  // thirty people.
  const view = await hostView(gameId);
  return NextResponse.json(view);
}
