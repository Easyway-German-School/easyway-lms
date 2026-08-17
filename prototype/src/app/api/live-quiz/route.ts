import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseQuestions } from "@/lib/assignments";
import { resolveHost } from "@/lib/live-quiz-views";
import { liveWhere } from "@/lib/live-presence";
import {
  DEFAULT_SECONDS_PER_QUESTION,
  MAX_SECONDS_PER_QUESTION,
  MIN_SECONDS_PER_QUESTION,
  joinableWhere,
  snapshotQuestions,
  uniquePin,
} from "@/lib/live-quiz";

export const dynamic = "force-dynamic";

/**
 * Start a game, and list the quizzes a tutor could start one from.
 *
 * Built for a branch classroom: a laptop on a projector and thirty phones on
 * the school wifi. Nothing here requires a video session, a room name or a
 * LiveKit token — a game is a row with a PIN, and the classroom is the actual
 * room the students are sitting in.
 */

/** The quizzes this tutor can play, and any game of theirs still open. */
export async function GET() {
  const host = await resolveHost();
  if (!host) return NextResponse.json({ error: "Staff access required" }, { status: 403 });

  const quizzes = await prisma.assignment.findMany({
    where: {
      type: "quiz",
      // An admin demonstrating the feature should see the school's quizzes; a
      // tutor should see the ones they set. Neither wants the other's list.
      ...(host.isAdmin ? {} : { lecturerId: host.lecturerId ?? "__none__" }),
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      title: true,
      level: true,
      questions: true,
      createdAt: true,
      branch: { select: { name: true } },
    },
  });

  const open = await prisma.quizGame.findFirst({
    where: { hostUserId: host.userId, ...joinableWhere() },
    orderBy: { createdAt: "desc" },
    select: { id: true, pin: true, title: true, phase: true, createdAt: true },
  });

  /**
   * Games already played, so the results are reachable.
   *
   * Without this the scores were written and there was no door to them, which
   * is the same as not keeping them — and keeping them was the whole reason to
   * build this here instead of linking to Kahoot.
   */
  const past = await prisma.quizGame.findMany({
    where: {
      phase: "ended",
      ...(host.isAdmin ? {} : { hostUserId: host.userId }),
    },
    orderBy: { endedAt: "desc" },
    take: 25,
    select: {
      id: true,
      title: true,
      endedAt: true,
      createdAt: true,
      _count: { select: { players: true } },
    },
  });

  // So the setup screen can say the rule rather than only enforcing it on the
  // click. See the online-cohort guard in POST.
  const hostLecturer = host.lecturerId
    ? await prisma.lecturer.findUnique({
        where: { id: host.lecturerId },
        select: { branch: { select: { mode: true } } },
      })
    : null;

  return NextResponse.json({
    quizzes: quizzes
      .map((quiz) => {
        const questions = parseQuestions(quiz.questions);
        const playable = questions.filter((question) => question.type !== "paragraph");
        return {
          id: quiz.id,
          title: quiz.title,
          level: quiz.level,
          branchName: quiz.branch?.name ?? null,
          questionCount: playable.length,
          droppedCount: questions.length - playable.length,
          createdAt: quiz.createdAt,
        };
      })
      // A quiz of nothing but essays cannot be played, so it is not offered.
      // Listing it and failing on the click would be a worse way to say so.
      .filter((quiz) => quiz.questionCount > 0),
    openGame: open,
    requiresLiveClass: hostLecturer?.branch?.mode === "online",
    pastGames: past.map((game) => ({
      id: game.id,
      title: game.title,
      endedAt: (game.endedAt ?? game.createdAt).toISOString(),
      playerCount: game._count.players,
    })),
  });
}

/**
 * Create the game.
 *
 * The questions are COPIED here, not referenced. A tutor who fixes a typo in
 * the source quiz halfway through a lesson must not change what a question was
 * worth after half the class has answered it, and a game re-read in March must
 * still show the paper that was actually played.
 */
export async function POST(request: NextRequest) {
  const host = await resolveHost();
  if (!host) return NextResponse.json({ error: "Staff access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const assignmentId = String(body?.assignmentId ?? "");
  if (!assignmentId) {
    return NextResponse.json({ error: "Pick a quiz to play" }, { status: 400 });
  }

  const quiz = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      title: true,
      questions: true,
      level: true,
      branchId: true,
      sessionSlot: true,
      lecturerId: true,
    },
  });
  if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  const seconds = Math.max(
    MIN_SECONDS_PER_QUESTION,
    Math.min(MAX_SECONDS_PER_QUESTION, Number(body?.secondsPerQuestion) || DEFAULT_SECONDS_PER_QUESTION),
  );
  const shuffled = body?.shuffle === true;
  const speedBonus = body?.speedBonus !== false;
  const teamMode = body?.teamMode === true;

  const snapshot = snapshotQuestions(quiz.questions, { shuffle: shuffled });
  if (snapshot.questions.length === 0) {
    return NextResponse.json(
      { error: "That quiz has no questions a live game can run." },
      { status: 400 },
    );
  }

  /**
   * The cohort is taken from the TUTOR, not the quiz.
   *
   * A quiz row carries the level and branch it was set for, which is usually
   * the same thing — but a tutor pulling up last term's A1 paper to revise with
   * their current class would otherwise stamp the game with a cohort nobody in
   * the room belongs to, and the one-tap join would offer it to the wrong
   * class. Whoever is standing in front of the projector decides whose game
   * this is.
   */
  const lecturer = host.lecturerId
    ? await prisma.lecturer.findUnique({
        where: { id: host.lecturerId },
        select: {
          id: true,
          branchId: true,
          level: true,
          sessionSlot: true,
          branch: { select: { mode: true } },
        },
      })
    : null;

  /**
   * Launched from inside a live class, rather than the projector/PIN flow this
   * route was originally built for (see the file header — a physical classroom
   * needs no video session at all, and that path stays exactly as it was).
   *
   * When a `liveSessionId` IS supplied, it must name a session this tutor is
   * actually running right now — not closed, not somebody else's. Trusting an
   * id from the client without this check would let a stale tab tag a brand
   * new game with a class that ended an hour ago.
   */
  let liveSessionId: string | null = null;
  const requestedSessionId = String(body?.liveSessionId ?? "").trim();
  if (requestedSessionId) {
    const session = await prisma.liveClassSession.findFirst({
      where: {
        id: requestedSessionId,
        ...liveWhere(),
        OR: [
          { startedByUserId: host.userId },
          ...(lecturer?.id ? [{ lecturerId: lecturer.id }] : []),
        ],
      },
      select: { id: true },
    });
    if (!session) {
      return NextResponse.json(
        { error: "That live class isn't open anymore — start a new one and launch the quiz from there." },
        { status: 400 },
      );
    }
    liveSessionId = session.id;
  }

  /**
   * AN ONLINE COHORT ONLY PLAYS INSIDE A LESSON.
   *
   * The PIN-and-projector flow assumes a room: thirty students sitting
   * together, one screen, a tutor who can see who is playing. An online
   * cohort has none of that — a PIN broadcast to a class nobody is currently
   * attending is a quiz sitting open on the internet with no supervision and
   * no shared moment, which is the opposite of what makes this format work.
   * So for an online branch, the live lesson IS the room, and there is no
   * game without one. Physical and hybrid branches are untouched.
   */
  if (!liveSessionId && lecturer?.branch?.mode === "online") {
    return NextResponse.json(
      {
        error:
          "Online classes play this inside the live lesson. Start your live class first, then launch the quiz from there.",
      },
      { status: 400 },
    );
  }

  const game = await prisma.quizGame.create({
    data: {
      pin: await uniquePin(),
      assignmentId: quiz.id,
      questions: snapshot.questions as unknown as object,
      lecturerId: lecturer?.id ?? null,
      hostUserId: host.userId,
      branchId: lecturer?.branchId ?? quiz.branchId ?? null,
      level: lecturer?.level ?? quiz.level ?? null,
      sessionSlot: lecturer?.sessionSlot ?? quiz.sessionSlot ?? null,
      liveSessionId,
      title: quiz.title,
      secondsPerQuestion: seconds,
      speedBonus,
      shuffled,
      teamMode,
      phase: "lobby",
      currentIndex: -1,
    },
    select: { id: true, pin: true, title: true },
  });

  return NextResponse.json({
    game,
    questionCount: snapshot.questions.length,
    dropped: snapshot.dropped,
  });
}
