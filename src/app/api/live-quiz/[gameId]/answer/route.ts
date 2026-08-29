import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseQuestions, type Question } from "@/lib/assignments";
import { resolvePlayer } from "@/lib/live-quiz-views";
import { LATE_ANSWER_GRACE_MS, scoreAnswer } from "@/lib/live-quiz";

export const dynamic = "force-dynamic";

/**
 * One tap, scored.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT IS ALLOWED TO SAY
 * ---------------------------------------------------------------------------
 * Which question, and which answer. That is the whole list. It does not send
 * how long it took, and it would not be believed if it did — the elapsed time
 * is `now - questionStartedAt`, both read here, and it is the only input to the
 * speed bonus. The question index is sent purely so a tap that raced a phase
 * change lands on the question the student was actually looking at rather than
 * being silently credited to the next one.
 */

/** Coerce the payload into the shape this question type expects, and no other. */
function normaliseAnswer(question: Question, raw: unknown): unknown {
  switch (question.type) {
    case "choice": {
      const index = Number(raw);
      return Number.isInteger(index) && index >= 0 && index < question.options.length ? index : -1;
    }
    case "multi": {
      const picked = Array.isArray(raw) ? raw : [];
      return [
        ...new Set(
          picked
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < question.options.length),
        ),
      ].sort((a, b) => a - b);
    }
    case "boolean":
      // The phone renders True as option 0 and False as option 1, so both the
      // index and the raw boolean arrive here depending on the control used.
      return raw === true || raw === 0 || raw === "0";
    case "short":
      return String(raw ?? "").slice(0, 200);
    default:
      return null;
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;

  const player = await resolvePlayer();
  if (!player) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const index = Number(body?.index);

  const now = new Date();

  const game = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      phase: true,
      currentIndex: true,
      questions: true,
      questionStartedAt: true,
      questionEndsAt: true,
      secondsPerQuestion: true,
      speedBonus: true,
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const me = await prisma.quizGamePlayer.findUnique({
    where: { gameId_studentId: { gameId, studentId: player.studentId } },
    select: { id: true, streak: true, bestStreak: true },
  });
  if (!me) return NextResponse.json({ error: "You have not joined this game" }, { status: 403 });

  if (game.phase !== "question" || game.currentIndex !== index) {
    // Not an error the student did anything about — they tapped as the screen
    // changed. Answered:false and a 200 keeps it out of the console and out of
    // their face.
    return NextResponse.json({ accepted: false, reason: "moved-on" });
  }

  /**
   * The buzzer, plus the time it takes a tap to cross the country.
   *
   * A student on a branch's wifi who pressed at 19.8 seconds pressed in time,
   * whatever the request clock says when it lands. The grace cannot be farmed:
   * `msTaken` is clamped to the question length inside `scoreAnswer`, so an
   * answer inside the grace window is worth exactly what one on the final tick
   * is worth and never more.
   */
  const deadline = game.questionEndsAt
    ? game.questionEndsAt.getTime() + LATE_ANSWER_GRACE_MS
    : 0;
  if (!deadline || now.getTime() > deadline) {
    return NextResponse.json({ accepted: false, reason: "too-late" });
  }

  const questions = parseQuestions(game.questions);
  const question = questions[index];
  if (!question) return NextResponse.json({ accepted: false, reason: "moved-on" });

  const answer = normaliseAnswer(question, body?.answer);
  const limitMs = game.secondsPerQuestion * 1000;
  const msTaken = game.questionStartedAt
    ? now.getTime() - game.questionStartedAt.getTime()
    : limitMs;

  const outcome = scoreAnswer({
    question,
    answer,
    msTaken,
    limitMs,
    speedBonus: game.speedBonus,
    streak: me.streak,
  });

  const nextStreak = outcome.correct ? me.streak + 1 : 0;

  try {
    /**
     * Both writes or neither.
     *
     * The unique constraint on (playerId, questionIndex) is the anti-cheat, and
     * putting it inside the transaction is what makes it one: a second tap that
     * races the first is refused by the database, and the score update that
     * would have gone with it is rolled back rather than applied twice. A
     * check-then-write in application code cannot promise that — thirty phones
     * on one wifi produce exactly the double-submit it would miss.
     */
    await prisma.$transaction([
      prisma.quizGameAnswer.create({
        data: {
          gameId,
          playerId: me.id,
          questionIndex: index,
          answer: answer as Prisma.InputJsonValue,
          correct: outcome.correct,
          credit: outcome.credit,
          points: outcome.points,
          msTaken: Math.max(0, msTaken),
          answeredAt: now,
        },
      }),
      prisma.quizGamePlayer.update({
        where: { id: me.id },
        data: {
          // Incremented rather than assigned: the read above is a snapshot, and
          // a score written back as an absolute would lose whatever landed in
          // between.
          score: { increment: outcome.points },
          answered: { increment: 1 },
          ...(outcome.correct ? { correct: { increment: 1 } } : {}),
          streak: nextStreak,
          bestStreak: Math.max(me.bestStreak, nextStreak),
          lastSeenAt: now,
        },
      }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ accepted: false, reason: "already-answered" });
    }
    throw error;
  }

  /**
   * The result is NOT returned.
   *
   * A phone that learned it was right the instant it tapped would be a phone
   * the student next to it can read, and in a room where everyone is within
   * arm's reach that is the game solved by the second question. The tap is
   * confirmed; whether it was right arrives with everyone else's at reveal.
   */
  return NextResponse.json({ accepted: true });
}
