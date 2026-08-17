import { prisma } from "@/lib/prisma";
import { requireAuthSession } from "@/lib/auth";
import { parseQuestions, type Question } from "@/lib/assignments";
import {
  correctAnswerFor,
  displayOptions,
  publicQuestion,
  shapeFor,
  standingsOf,
  type GamePhase,
  type StandingRow,
} from "@/lib/live-quiz";

/**
 * What each side of the room is allowed to see, and when.
 *
 * ---------------------------------------------------------------------------
 * THE ROOM THIS IS BUILT FOR
 * ---------------------------------------------------------------------------
 * A physical branch classroom. One laptop on a projector, thirty phones on the
 * school wifi, and a tutor who is standing up. There is no video call — the
 * students are three metres away — so nothing in this feature may depend on a
 * LiveKit session existing, and the student side is gated by nothing to do with
 * delivery mode. A campus student is the intended player, not the exception.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO VIEWS AND NOT ONE
 * ---------------------------------------------------------------------------
 * The projector and the phone are looking at the same row and must be told
 * different things about it. During a question the big screen shows the answer
 * distribution filling up; a phone that received the same payload would be
 * showing thirty students how the class is voting, and in a room where everyone
 * can see everyone the game would be over in one round. So the split is not a
 * convenience for the UI — it is the rule that makes the game playable, and it
 * is enforced here rather than in a component, because a component that forgets
 * is a component that has already sent the answer key to a phone.
 */

/* -------------------------------------------------------------------------- */
/* Who is asking                                                              */
/* -------------------------------------------------------------------------- */

export type HostIdentity = { userId: string; lecturerId: string | null; isAdmin: boolean };

/**
 * Only staff run a game. Admins are included because the office demonstrates
 * this to visiting schools and because a tutor whose laptop died mid-lesson
 * needs somebody able to end the game.
 */
export async function resolveHost(): Promise<HostIdentity | null> {
  const session = await requireAuthSession();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, lecturer: { select: { id: true } } },
  });

  const role = String(user?.role ?? "").toLowerCase();
  if (!user || (role !== "lecturer" && role !== "admin")) return null;

  return { userId: user.id, lecturerId: user.lecturer?.id ?? null, isAdmin: role === "admin" };
}

export type PlayerIdentity = { userId: string; studentId: string; name: string };

/**
 * Any signed-in student of this school may play.
 *
 * Deliberately NOT `canAttendLive`. That check exists to stop a campus student
 * being invited to a video class they cannot use, and applying it here would
 * lock out exactly the students this feature was asked for — the ones sitting
 * in the branch classroom with the projector in front of them.
 *
 * Nor is it gated on the tuition paywall. The game is played in a room the
 * student is already sitting in; a padlock on the one screen everybody else in
 * the class is looking at teaches them nothing about paying and a great deal
 * about being excluded in public.
 */
export async function resolvePlayer(): Promise<PlayerIdentity | null> {
  const session = await requireAuthSession();
  if (!session?.user?.id) return null;

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) return null;

  return { userId: session.user.id, studentId: student.id, name: student.user.name ?? "Student" };
}

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

export type ViewOption = {
  index: number;
  text: string;
  shape: string;
  color: string;
  label: string;
};

export type ViewQuestion = {
  index: number;
  count: number;
  type: string;
  prompt: string;
  points: number;
  options: ViewOption[];
  /** Checkboxes and typed answers need a confirm button; a single tap does not. */
  needsSubmit: boolean;
};

/**
 * The prompt and the option text go to the phone as well as the projector.
 *
 * The game this copies hides them, to force thirty faces up at the board. That
 * is the right call in a room where the board can be read. It is the wrong call
 * here: these are German words being learned, half of them long, and a branch
 * classroom in afternoon sun with a projector at the far end is a place where
 * "was hast du gestern gemacht?" is a grey smear from the back row. A student
 * who cannot read the question cannot answer it, and the reason will look to
 * everyone — including them — like not knowing the German.
 */
function toViewQuestion(question: Question, index: number, count: number): ViewQuestion {
  const pub = publicQuestion(question);
  const options = displayOptions(pub).map((text, optionIndex) => {
    const shape = shapeFor(optionIndex);
    return {
      index: optionIndex,
      text,
      shape: shape.shape,
      color: shape.color,
      label: shape.label,
    };
  });

  return {
    index,
    count,
    type: pub.type,
    prompt: pub.prompt,
    points: pub.points,
    options,
    needsSubmit: pub.type === "multi" || pub.type === "short",
  };
}

type GameRow = {
  id: string;
  pin: string;
  title: string;
  phase: string;
  currentIndex: number;
  questions: unknown;
  questionStartedAt: Date | null;
  questionEndsAt: Date | null;
  secondsPerQuestion: number;
  speedBonus: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
};

/**
 * How soon to ask again.
 *
 * Decided by the server rather than hardcoded in the client, because the right
 * answer changes with the phase and only the server knows which one it is in.
 * A question is the only moment anything urgent can happen; a standings screen
 * can sit for a minute while the tutor talks over it, and thirty phones asking
 * every second through that would be thirty phones flattening their batteries
 * to learn nothing.
 *
 * The countdown itself does NOT depend on this. Every client is given
 * `serverNow` alongside `endsAt` and runs its own clock off the difference, so
 * the timer is smooth at 60fps on a poll that arrives every two seconds — and
 * it is the SERVER's clock being counted down, not the phone's, which is what
 * makes a phone with the wrong time still show the right number of seconds.
 */
function pollMsFor(phase: string): number {
  if (phase === "question") return 1000;
  if (phase === "lobby") return 2000;
  if (phase === "ended") return 5000;
  return 1500;
}

function questionsOf(game: GameRow): Question[] {
  return parseQuestions(game.questions);
}

/** Whether the buzzer has gone, by the server's clock and nobody else's. */
function isClosed(game: GameRow, now: Date): boolean {
  if (game.phase !== "question") return true;
  return !game.questionEndsAt || now >= game.questionEndsAt;
}

/* -------------------------------------------------------------------------- */
/* The projector                                                              */
/* -------------------------------------------------------------------------- */

export type HostView = {
  role: "host";
  pollMs: number;
  serverNow: number;
  game: {
    id: string;
    pin: string;
    title: string;
    phase: GamePhase;
    currentIndex: number;
    questionCount: number;
    secondsPerQuestion: number;
    speedBonus: boolean;
    startedAt: string | null;
    endedAt: string | null;
  };
  endsAt: number | null;
  question: ViewQuestion | null;
  playerCount: number;
  answeredCount: number;
  /** Names only, for the lobby. Thirty names arriving one at a time IS the pre-show. */
  lobby: Array<{ id: string; name: string }>;
  reveal: {
    correctIndexes: number[];
    correctText: string | null;
    /** Votes per option index. */
    distribution: number[];
    /** What students actually typed, for a short answer. Most common first. */
    typed: Array<{ text: string; count: number; correct: boolean }>;
    correctCount: number;
    noAnswerCount: number;
  } | null;
  standings: StandingRow[] | null;
};

export async function hostView(gameId: string): Promise<HostView | null> {
  const now = new Date();

  const game = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      pin: true,
      title: true,
      phase: true,
      currentIndex: true,
      questions: true,
      questionStartedAt: true,
      questionEndsAt: true,
      secondsPerQuestion: true,
      speedBonus: true,
      startedAt: true,
      endedAt: true,
    },
  });
  if (!game) return null;

  const questions = questionsOf(game);
  const current = game.currentIndex >= 0 ? questions[game.currentIndex] : undefined;

  const players = await prisma.quizGamePlayer.findMany({
    where: { gameId },
    select: {
      id: true,
      studentId: true,
      score: true,
      correct: true,
      answered: true,
      streak: true,
      joinedAt: true,
      student: { select: { user: { select: { name: true } } } },
    },
    orderBy: { joinedAt: "asc" },
  });

  const named = players.map((player) => ({
    id: player.id,
    studentId: player.studentId,
    name: player.student.user.name ?? "Student",
    score: player.score,
    correct: player.correct,
    answered: player.answered,
    streak: player.streak,
  }));

  const answers =
    game.currentIndex >= 0
      ? await prisma.quizGameAnswer.findMany({
          where: { gameId, questionIndex: game.currentIndex },
          select: { answer: true, correct: true, points: true },
        })
      : [];

  const showReveal = game.phase === "reveal" && current;
  const showStandings = game.phase === "standings" || game.phase === "ended";

  return {
    role: "host",
    pollMs: pollMsFor(game.phase),
    serverNow: now.getTime(),
    game: {
      id: game.id,
      pin: game.pin,
      title: game.title,
      phase: game.phase as GamePhase,
      currentIndex: game.currentIndex,
      questionCount: questions.length,
      secondsPerQuestion: game.secondsPerQuestion,
      speedBonus: game.speedBonus,
      startedAt: game.startedAt?.toISOString() ?? null,
      endedAt: game.endedAt?.toISOString() ?? null,
    },
    endsAt: game.questionEndsAt?.getTime() ?? null,
    question: current ? toViewQuestion(current, game.currentIndex, questions.length) : null,
    playerCount: players.length,
    answeredCount: answers.length,
    lobby: named.map((player) => ({ id: player.id, name: player.name })),
    reveal: showReveal
      ? buildReveal(current, answers, players.length)
      : null,
    standings: showStandings ? standingsOf(named) : null,
  };
}

function buildReveal(
  question: Question,
  answers: Array<{ answer: unknown; correct: boolean }>,
  playerCount: number,
): NonNullable<HostView["reveal"]> {
  const key = correctAnswerFor(question);
  const optionCount = displayOptions(publicQuestion(question)).length;
  const distribution = new Array<number>(optionCount).fill(0);

  const typedCounts = new Map<string, { count: number; correct: boolean }>();

  for (const row of answers) {
    const value = row.answer;

    if (question.type === "short") {
      const text = String(value ?? "").trim();
      if (!text) continue;
      const existing = typedCounts.get(text.toLowerCase());
      if (existing) existing.count += 1;
      else typedCounts.set(text.toLowerCase(), { count: 1, correct: row.correct });
      continue;
    }

    if (question.type === "multi") {
      const picked = Array.isArray(value) ? value : [];
      for (const index of picked) {
        const n = Number(index);
        if (Number.isInteger(n) && n >= 0 && n < optionCount) distribution[n] += 1;
      }
      continue;
    }

    if (question.type === "boolean") {
      // Stored as a boolean, displayed as option 0 (True) / 1 (False).
      const index = value === true ? 0 : value === false ? 1 : -1;
      if (index >= 0) distribution[index] += 1;
      continue;
    }

    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n < optionCount) distribution[n] += 1;
  }

  const typed = [...typedCounts.entries()]
    .map(([text, entry]) => ({ text, count: entry.count, correct: entry.correct }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    correctIndexes: key.indexes,
    correctText: key.text,
    distribution,
    typed,
    correctCount: answers.filter((row) => row.correct).length,
    // The most useful number on the screen and the one every version of this
    // leaves out: not who got it wrong, but how many did not answer at all.
    // Those are the students who have stopped playing, and a tutor who can see
    // that number climbing knows something a scoreboard will never tell them.
    noAnswerCount: Math.max(0, playerCount - answers.length),
  };
}

/* -------------------------------------------------------------------------- */
/* The phone                                                                  */
/* -------------------------------------------------------------------------- */

export type PlayerView = {
  role: "player";
  pollMs: number;
  serverNow: number;
  game: {
    id: string;
    pin: string;
    title: string;
    phase: GamePhase;
    currentIndex: number;
    questionCount: number;
    secondsPerQuestion: number;
    speedBonus: boolean;
  };
  endsAt: number | null;
  /** Null while the question is closed or not yet asked. */
  question: ViewQuestion | null;
  me: {
    name: string;
    score: number;
    place: number | null;
    playerCount: number;
    streak: number;
    correct: number;
  };
  /** My answer to the current question — echoed back so a reload does not look like a lost answer. */
  myAnswer: { submitted: boolean; value: unknown } | null;
  /** Only ever populated in `reveal`. */
  outcome: {
    correct: boolean;
    credit: number;
    points: number;
    correctIndexes: number[];
    correctText: string | null;
    /** True when they never answered — a different message from getting it wrong. */
    missed: boolean;
  } | null;
  /** Top of the table, plus my own row if I am not in it. */
  standings: StandingRow[] | null;
  myStanding: StandingRow | null;
};

function buildOutcome(
  question: Question,
  mine: { correct: boolean; credit: number; points: number } | null,
): NonNullable<PlayerView["outcome"]> {
  const key = correctAnswerFor(question);
  return {
    correct: mine?.correct ?? false,
    credit: mine?.credit ?? 0,
    points: mine?.points ?? 0,
    correctIndexes: key.indexes,
    correctText: key.text,
    // "You ran out of time" and "that was wrong" are different sentences and a
    // student who was still reading deserves the first one.
    missed: !mine,
  };
}

export async function playerView(gameId: string, studentId: string): Promise<PlayerView | null> {
  const now = new Date();

  const game = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      pin: true,
      title: true,
      phase: true,
      currentIndex: true,
      questions: true,
      questionStartedAt: true,
      questionEndsAt: true,
      secondsPerQuestion: true,
      speedBonus: true,
      startedAt: true,
      endedAt: true,
    },
  });
  if (!game) return null;

  const me = await prisma.quizGamePlayer.findUnique({
    where: { gameId_studentId: { gameId, studentId } },
    select: {
      id: true,
      score: true,
      streak: true,
      correct: true,
      student: { select: { user: { select: { name: true } } } },
    },
  });
  if (!me) return null;

  const questions = questionsOf(game);
  const current = game.currentIndex >= 0 ? questions[game.currentIndex] : undefined;
  const closed = isClosed(game, now);

  const players = await prisma.quizGamePlayer.findMany({
    where: { gameId },
    select: {
      id: true,
      studentId: true,
      score: true,
      correct: true,
      answered: true,
      streak: true,
      student: { select: { user: { select: { name: true } } } },
    },
  });

  const table = standingsOf(
    players.map((player) => ({
      id: player.id,
      studentId: player.studentId,
      name: player.student.user.name ?? "Student",
      score: player.score,
      correct: player.correct,
      answered: player.answered,
      streak: player.streak,
    })),
  );
  const myRow = table.find((row) => row.playerId === me.id) ?? null;

  const myAnswer =
    game.currentIndex >= 0
      ? await prisma.quizGameAnswer.findUnique({
          where: { playerId_questionIndex: { playerId: me.id, questionIndex: game.currentIndex } },
          select: { answer: true, correct: true, credit: true, points: true },
        })
      : null;

  const showStandings = game.phase === "standings" || game.phase === "ended";

  return {
    role: "player",
    pollMs: pollMsFor(game.phase),
    serverNow: now.getTime(),
    game: {
      id: game.id,
      pin: game.pin,
      title: game.title,
      phase: game.phase as GamePhase,
      currentIndex: game.currentIndex,
      questionCount: questions.length,
      secondsPerQuestion: game.secondsPerQuestion,
      speedBonus: game.speedBonus,
    },
    endsAt: game.questionEndsAt?.getTime() ?? null,
    // The question goes out only while it is genuinely open. Once the buzzer
    // has gone there is nothing on this screen to act on, and leaving the
    // options rendered invites a student to keep tapping a dead button and
    // conclude their phone lost the answer.
    question: current && game.phase === "question" && !closed
      ? toViewQuestion(current, game.currentIndex, questions.length)
      : null,
    me: {
      name: me.student.user.name ?? "Student",
      score: me.score,
      place: myRow?.place ?? null,
      playerCount: players.length,
      streak: me.streak,
      correct: me.correct,
    },
    myAnswer: myAnswer ? { submitted: true, value: myAnswer.answer } : null,
    // The answer key crosses to a phone at exactly one moment: reveal. Before
    // that this is null, so a student reading the network tab during a question
    // finds nothing to read.
    outcome: game.phase === "reveal" && current ? buildOutcome(current, myAnswer) : null,
    standings: showStandings ? table.slice(0, 5) : null,
    myStanding: showStandings ? myRow : null,
  };
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a tutor reads after the room has emptied.
 *
 * The whole argument for building this game inside the platform rather than
 * linking to a third-party one was that the scores would still be here in
 * March. Until this existed they were: the rows were written and nothing could
 * open them, which is the same as not having them.
 *
 * It leads with the QUESTIONS, not the leaderboard. Who won is already known —
 * the room watched it happen on the podium. What nobody can see from a
 * leaderboard is which question the class fell over, and that is the one fact
 * here that changes what a tutor does on Monday. So questions are returned
 * worst-first.
 *
 * It deliberately does NOT mark attendance. A quiz can be played from a
 * bedroom, and a register that quietly counts "was in the game" as "was in the
 * lesson" is a record the school cannot defend. Who played is reported, and a
 * human decides what that means.
 */
export type QuizReport = {
  game: {
    id: string;
    title: string;
    pin: string;
    phase: GamePhase;
    questionCount: number;
    playerCount: number;
    startedAt: string | null;
    endedAt: string | null;
    speedBonus: boolean;
    secondsPerQuestion: number;
    /** Set when it was played inside a video lesson. */
    liveSessionId: string | null;
  };
  /** Worst-answered first — the point of the screen. */
  questions: Array<{
    index: number;
    prompt: string;
    type: string;
    points: number;
    correctText: string | null;
    answered: number;
    correct: number;
    /** 0-100 of those who answered. Null when nobody did. */
    accuracy: number | null;
    /** Seconds, mean over correct answers only. Null when there were none. */
    averageSeconds: number | null;
  }>;
  /** Highest score first, the order the podium used. */
  players: Array<{
    studentId: string;
    name: string;
    score: number;
    correct: number;
    answered: number;
    bestStreak: number;
    place: number;
    /** 0-100 of the questions in the game, not of the ones they answered. */
    accuracy: number;
  }>;
  classAccuracy: number | null;
};

export async function quizReport(gameId: string): Promise<QuizReport | null> {
  const game = await prisma.quizGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      title: true,
      pin: true,
      phase: true,
      questions: true,
      startedAt: true,
      endedAt: true,
      speedBonus: true,
      secondsPerQuestion: true,
      liveSessionId: true,
    },
  });
  if (!game) return null;

  const questions = parseQuestions(game.questions);

  const [players, answers] = await Promise.all([
    prisma.quizGamePlayer.findMany({
      where: { gameId },
      select: {
        studentId: true,
        score: true,
        correct: true,
        answered: true,
        bestStreak: true,
        student: { select: { user: { select: { name: true } } } },
      },
    }),
    // Grouped rather than per-question queried: a 20-question game would
    // otherwise be 20 round trips against a 9-connection pool, which is the
    // exact shape of the bug that took the community hub down.
    prisma.quizGameAnswer.findMany({
      where: { gameId },
      select: { questionIndex: true, correct: true, msTaken: true },
    }),
  ]);

  const byIndex = new Map<number, { answered: number; correct: number; totalMs: number; correctMs: number }>();
  for (const answer of answers) {
    const bucket = byIndex.get(answer.questionIndex) ?? { answered: 0, correct: 0, totalMs: 0, correctMs: 0 };
    bucket.answered += 1;
    if (answer.correct) {
      bucket.correct += 1;
      bucket.correctMs += answer.msTaken;
    }
    bucket.totalMs += answer.msTaken;
    byIndex.set(answer.questionIndex, bucket);
  }

  const questionRows = questions.map((question, index) => {
    const bucket = byIndex.get(index);
    const answered = bucket?.answered ?? 0;
    const correct = bucket?.correct ?? 0;
    return {
      index,
      prompt: question.prompt,
      type: question.type,
      points: question.points,
      correctText: correctAnswerFor(question).text,
      answered,
      correct,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
      averageSeconds: correct > 0 ? Math.round(((bucket?.correctMs ?? 0) / correct) / 100) / 10 : null,
    };
  });

  const table = standingsOf(
    players.map((player) => ({
      // Keyed by studentId here rather than the QuizGamePlayer row id: the
      // report is read months later against students, not against rows that
      // only existed for one game.
      id: player.studentId,
      studentId: player.studentId,
      name: player.student.user.name ?? "Student",
      score: player.score,
      correct: player.correct,
      answered: player.answered,
      streak: player.bestStreak,
    })),
  );
  const placeOf = new Map(table.map((row) => [row.playerId, row.place]));

  const totalAnswered = answers.length;
  const totalCorrect = answers.filter((answer) => answer.correct).length;

  return {
    game: {
      id: game.id,
      title: game.title,
      pin: game.pin,
      phase: game.phase as GamePhase,
      questionCount: questions.length,
      playerCount: players.length,
      startedAt: game.startedAt?.toISOString() ?? null,
      endedAt: game.endedAt?.toISOString() ?? null,
      speedBonus: game.speedBonus,
      secondsPerQuestion: game.secondsPerQuestion,
      liveSessionId: game.liveSessionId,
    },
    // Unanswered questions sort last rather than first: "0 of 0" is not the
    // hardest question in the paper, it is one the game never reached.
    questions: [...questionRows].sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999)),
    players: players
      .map((player) => ({
        studentId: player.studentId,
        name: player.student.user.name ?? "Student",
        score: player.score,
        correct: player.correct,
        answered: player.answered,
        bestStreak: player.bestStreak,
        place: placeOf.get(player.studentId) ?? 0,
        accuracy: questions.length > 0 ? Math.round((player.correct / questions.length) * 100) : 0,
      }))
      .sort((a, b) => a.place - b.place),
    classAccuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null,
  };
}
