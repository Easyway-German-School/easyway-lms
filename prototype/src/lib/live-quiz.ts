import { prisma } from "@/lib/prisma";
import {
  gradeSubmission,
  parseQuestions,
  toPublicQuestions,
  type Question,
  type PublicQuestion,
} from "@/lib/assignments";

/**
 * The live quiz game — the rules of play.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * The school's tutors already run revision as a game-show on a third-party
 * site: question on the projector, phones in hands, a countdown, points that
 * fall with the seconds, a leaderboard between rounds. It works because it is
 * synchronous and noisy — the exact opposite of the homework quizzes this
 * platform already has, which are quiet and solitary and due on Friday.
 *
 * Building it here rather than linking out is not about the questions. It is
 * that a game played somewhere else has a separate login, a separate roster,
 * no attendance link, and a leaderboard of nicknames that never becomes a fact
 * about a student. Played here, it is the same room, the same names, and a
 * record a tutor can open in March.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THAT SHAPES EVERYTHING
 * ---------------------------------------------------------------------------
 * The server holds the clock. Every score in this file is a function of
 * `answeredAt - questionStartedAt`, both of which are read from the database,
 * neither of which any browser can influence. A client never sends a duration
 * and is never believed about one. That is why the game state is a row rather
 * than a broadcast on the classroom data channel: the moment the stopwatch
 * lives in the tutor's tab, the winner is decided by whoever is best at
 * editing a tab. See the comment above `model QuizGame` in schema.prisma for
 * the two other reasons.
 */

/* -------------------------------------------------------------------------- */
/* Phases                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `reveal` and `standings` are separate on purpose.
 *
 * Showing the correct answer and showing the table are two different moments in
 * a classroom. The first is quiet — everyone reads it, and the ones who got it
 * wrong learn something. The second is loud. Put them on one screen and nobody
 * looks at the answer, which turns a revision tool back into a slot machine.
 */
export const GAME_PHASES = ["lobby", "question", "reveal", "standings", "ended"] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export function isGamePhase(value: unknown): value is GamePhase {
  return typeof value === "string" && (GAME_PHASES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Timing                                                                     */
/* -------------------------------------------------------------------------- */

export const MIN_SECONDS_PER_QUESTION = 5;
export const MAX_SECONDS_PER_QUESTION = 120;
export const DEFAULT_SECONDS_PER_QUESTION = 20;

/**
 * How long after the buzzer an answer is still accepted.
 *
 * Not generosity — physics. A tap on a phone in Port Harcourt takes a good
 * fraction of a second to reach the server, and a student who pressed at 19.8
 * seconds pressed in time whatever the request header says. Rejecting them
 * would make the game feel rigged against exactly the students on the worst
 * connections, which is most of them.
 *
 * It cannot be farmed, because `msTaken` is clamped to the question length
 * before scoring: answering inside the grace period is worth the same as
 * answering on the final tick, never more.
 */
export const LATE_ANSWER_GRACE_MS = 1200;

/**
 * A game nobody has touched for this long is over, whatever its row says.
 *
 * The host is a browser and browsers close. Without this a laptop shut at the
 * end of a lesson leaves a game sitting in `lobby` forever, and the next day's
 * class gets offered a one-tap join into last week's revision.
 */
export const GAME_ABANDONED_AFTER_MS = 3 * 60 * 60_000;

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A one-mark question is worth up to 100 in a game.
 *
 * The multiplier exists so the numbers on the leaderboard are big enough to
 * move visibly between rounds — 3 points to 4 points reads as nothing, 300 to
 * 470 reads as a comeback — while the question's own `points` still does the
 * weighting it does on paper. A three-mark question is worth three times a
 * one-mark question here exactly as it is in the gradebook, because the tutor
 * set those weights for a reason and a game is not the place to overrule them.
 */
export const BASE_POINTS_PER_MARK = 100;

/**
 * The slowest correct answer is worth half the fastest.
 *
 * Kahoot's own curve, and the number matters more than it looks. Steeper and
 * the game is a reflex test that the strongest German speaker in the room can
 * lose to whoever has the newest phone; flatter and there is no reason to
 * hurry, which removes the tension that makes the format work at all. Half is
 * the setting where knowing the answer still beats guessing fast.
 */
export const SPEED_FLOOR = 0.5;

/** Each consecutive correct answer after the first adds this much, up to the cap. */
export const STREAK_STEP = 0.1;
export const STREAK_CAP = 0.5;

export type ScoreInput = {
  question: Question;
  answer: unknown;
  /** Server-measured, from `questionStartedAt`. */
  msTaken: number;
  limitMs: number;
  speedBonus: boolean;
  /** Consecutive correct answers BEFORE this one. */
  streak: number;
};

export type ScoreOutcome = {
  /** 0..1 — a checkbox question can be part right. */
  credit: number;
  /** Full marks only. A part-right answer is not a correct one on the tally. */
  correct: boolean;
  points: number;
};

/**
 * What one answer is worth.
 *
 * Marking is delegated to `gradeSubmission` rather than reimplemented. There is
 * one set of rules in this codebase for what counts as a right answer —
 * including the German normalisation that accepts `schoen` and refuses `schon`
 * — and a game that marked to its own slightly different standard would
 * eventually tell a student they were right on Tuesday and wrong on Friday for
 * typing the same word.
 */
export function scoreAnswer({
  question,
  answer,
  msTaken,
  limitMs,
  speedBonus,
  streak,
}: ScoreInput): ScoreOutcome {
  const graded = gradeSubmission([question], [answer]);
  const possible = graded.possible || 1;
  const credit = Math.max(0, Math.min(1, graded.earned / possible));

  if (credit <= 0) return { credit: 0, correct: false, points: 0 };

  // Clamped at both ends: a negative elapsed time (clock skew between the app
  // server and the database) must not pay a bonus, and the late-answer grace
  // must not out-earn the final tick.
  const elapsed = Math.max(0, Math.min(msTaken, limitMs));
  const speed = speedBonus && limitMs > 0 ? 1 - (1 - SPEED_FLOOR) * (elapsed / limitMs) : 1;

  const streakMultiplier = 1 + Math.min(streak * STREAK_STEP, STREAK_CAP);

  const base = question.points * BASE_POINTS_PER_MARK;
  const points = Math.round(base * credit * speed * streakMultiplier);

  return { credit, correct: credit >= 1, points };
}

/* -------------------------------------------------------------------------- */
/* The question snapshot                                                      */
/* -------------------------------------------------------------------------- */

export type SnapshotResult = {
  questions: Question[];
  /** Questions the source quiz had that a live game cannot run. */
  dropped: number;
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Reorder a question's options and move its answer key with them.
 *
 * Worth doing because a class that played the same quiz last week remembers
 * positions, not German — "it's the blue one" spreads across a room in about
 * four seconds. Rewriting the key at snapshot time rather than at display time
 * is what makes it safe: the stored paper and the stored answer always agree,
 * so a game re-read months later still marks correctly.
 */
function shuffleOptions(question: Question): Question {
  if (question.type === "choice") {
    const order = shuffle(question.options.map((_, index) => index));
    return {
      ...question,
      options: order.map((index) => question.options[index]),
      answerIndex: order.indexOf(question.answerIndex),
    };
  }

  if (question.type === "multi") {
    const order = shuffle(question.options.map((_, index) => index));
    return {
      ...question,
      options: order.map((index) => question.options[index]),
      answerIndexes: question.answerIndexes
        .map((index) => order.indexOf(index))
        .sort((a, b) => a - b),
    };
  }

  return question;
}

/**
 * Freeze a quiz into a game.
 *
 * Paragraph questions are dropped, and the count is returned so the tutor is
 * told rather than left to notice. There is no way to hand-mark an essay
 * against a twenty-second countdown in front of thirty people, and silently
 * including one would stall the game on a question nothing can score.
 */
export function snapshotQuestions(
  source: unknown,
  opts: { shuffle?: boolean } = {},
): SnapshotResult {
  const all = parseQuestions(source);
  const playable = all.filter((question) => question.type !== "paragraph");

  const ordered = opts.shuffle ? shuffle(playable).map(shuffleOptions) : playable;

  return { questions: ordered, dropped: all.length - playable.length };
}

/* -------------------------------------------------------------------------- */
/* What a player is allowed to see                                            */
/* -------------------------------------------------------------------------- */

/**
 * The colour and shape each answer wears.
 *
 * Shapes as well as colours, and that is not decoration. Roughly one boy in
 * twelve cannot reliably separate the red from the green, and a game where the
 * instruction is "press red" is a game he loses for a reason that has nothing
 * to do with German. The shape is the real identifier; the colour is how it is
 * found quickly.
 *
 * Drawn, not emoji — this project renders emoji in no portal, because they
 * arrive as whatever the operating system feels like and read as stray beside
 * a drawn icon set.
 */
export const ANSWER_SHAPES = [
  { shape: "triangle", color: "#e11d48", label: "Triangle" },
  { shape: "diamond", color: "#2563eb", label: "Diamond" },
  { shape: "circle", color: "#f59e0b", label: "Circle" },
  { shape: "square", color: "#16a34a", label: "Square" },
  { shape: "hexagon", color: "#7c3aed", label: "Hexagon" },
  { shape: "star", color: "#0d9488", label: "Star" },
] as const;

export type AnswerShape = (typeof ANSWER_SHAPES)[number]["shape"];

export function shapeFor(index: number): (typeof ANSWER_SHAPES)[number] {
  return ANSWER_SHAPES[index % ANSWER_SHAPES.length];
}

/**
 * True/false is rendered as two options like any other, so the phone has one
 * layout instead of two and a student never has to work out what kind of
 * question they are looking at while the clock runs.
 */
export const BOOLEAN_OPTIONS = ["True", "False"] as const;

/** The options a question shows on screen, whatever its underlying type. */
export function displayOptions(question: PublicQuestion): string[] {
  if (question.type === "choice" || question.type === "multi") return question.options;
  if (question.type === "boolean") return [...BOOLEAN_OPTIONS];
  return [];
}

export type PlayableQuestion = PublicQuestion & { index: number; count: number };

/**
 * Strip the answer key before a question goes out to a phone.
 *
 * Delegated to `toPublicQuestions`, which rebuilds each question field by field
 * rather than deleting a few — so a question type added later cannot carry its
 * new answer key out to the browser by default.
 */
export function publicQuestion(question: Question): PublicQuestion {
  return toPublicQuestions([question])[0];
}

/**
 * The correct answer, in the shape the reveal screen wants: which option
 * indexes to light up, and the text to print for a typed answer.
 */
export function correctAnswerFor(question: Question): { indexes: number[]; text: string | null } {
  switch (question.type) {
    case "choice":
      return { indexes: [question.answerIndex], text: null };
    case "multi":
      return { indexes: question.answerIndexes, text: null };
    case "boolean":
      return { indexes: [question.answer ? 0 : 1], text: null };
    case "short":
      return { indexes: [], text: question.accepted[0] ?? null };
    default:
      return { indexes: [], text: null };
  }
}

/* -------------------------------------------------------------------------- */
/* The PIN                                                                    */
/* -------------------------------------------------------------------------- */

const PIN_LENGTH = 6;

/**
 * Six digits, unlike the six letters a live class join code uses.
 *
 * Digits open a phone's numeric keypad. Letters open the full keyboard, where
 * autocorrect, autocapitalise and a fat thumb are all waiting — and this code
 * is typed by teenagers in a hurry while a countdown they can see is already
 * running. A leading zero is allowed and the field is a string, so the code
 * read off the board is the code that is typed in.
 */
function randomPin(): string {
  let out = "";
  for (let i = 0; i < PIN_LENGTH; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/**
 * A PIN unique among games that could still be joined.
 *
 * Deliberately NOT unique across all time, unlike a live class join code: the
 * column is unique so old rows do have to be dodged, but a PIN is short and the
 * space is only a million, so the retry loop matters. Eight collisions means
 * something is badly wrong and a seventh digit is a kinder failure than an
 * exception in front of a waiting class.
 */
export async function uniquePin(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = randomPin();
    const clash = await prisma.quizGame.findUnique({ where: { pin }, select: { id: true } });
    if (!clash) return pin;
  }
  return `${randomPin()}${Math.floor(Math.random() * 10)}`;
}

export function normalisePin(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, PIN_LENGTH + 1);
}

/* -------------------------------------------------------------------------- */
/* Standings                                                                  */
/* -------------------------------------------------------------------------- */

export type StandingRow = {
  playerId: string;
  studentId: string;
  name: string;
  score: number;
  correct: number;
  answered: number;
  streak: number;
  /** 1-based, with ties sharing a place. */
  place: number;
  /** Places gained since the previous question; null on the first. */
  movement: number | null;
};

export type PlayerForStanding = {
  id: string;
  studentId: string;
  name: string;
  score: number;
  correct: number;
  answered: number;
  streak: number;
};

/**
 * Rank the room.
 *
 * Ties share a place — two students on 1,340 are both second, and the next is
 * fourth. Inventing an order between them out of a row id would be a lie the
 * projector tells to a room that can do the arithmetic, and the tie is
 * genuinely the more interesting fact.
 *
 * `previous` is the score map from before this question, which is what makes
 * the arrows on the standings screen possible. That movement is the whole
 * reason anyone looks at the table between rounds.
 */
export function standingsOf(
  players: PlayerForStanding[],
  previous?: Map<string, number>,
): StandingRow[] {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );

  const priorPlaces = previous
    ? placeMap(
        [...players]
          .map((player) => ({ id: player.id, score: previous.get(player.id) ?? 0 }))
          .sort((a, b) => b.score - a.score),
      )
    : null;

  const places = placeMap(sorted.map((player) => ({ id: player.id, score: player.score })));

  return sorted.map((player) => {
    const place = places.get(player.id) ?? 1;
    const before = priorPlaces?.get(player.id);
    return {
      playerId: player.id,
      studentId: player.studentId,
      name: player.name,
      score: player.score,
      correct: player.correct,
      answered: player.answered,
      streak: player.streak,
      place,
      // Positive means climbed. Subtracting the new place from the old is the
      // right way round precisely because a smaller number is a better place.
      movement: before === undefined ? null : before - place,
    };
  });
}

/** Dense-with-gaps ranking: 1, 2, 2, 4. Input must already be sorted by score. */
function placeMap(sorted: Array<{ id: string; score: number }>): Map<string, number> {
  const out = new Map<string, number>();
  let place = 0;
  let lastScore: number | null = null;

  sorted.forEach((entry, index) => {
    if (lastScore === null || entry.score !== lastScore) {
      place = index + 1;
      lastScore = entry.score;
    }
    out.set(entry.id, place);
  });

  return out;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** Prisma `where` fragment for "this game can still be joined or played". */
export function joinableWhere(now: Date = new Date()) {
  return {
    endedAt: null,
    updatedAt: { gte: new Date(now.getTime() - GAME_ABANDONED_AFTER_MS) },
  };
}

/** Look a game up by the PIN somebody typed. Only ever returns a joinable one. */
export async function gameByPin(pin: string) {
  const normalised = normalisePin(pin);
  if (normalised.length < PIN_LENGTH) return null;

  return prisma.quizGame.findFirst({
    where: { pin: normalised, ...joinableWhere() },
    select: gameSelect,
  });
}

/**
 * The game this student could walk into without typing anything.
 *
 * Pinned to branch AND level AND sitting, for the same reason every other
 * cohort query in this codebase is: a branch runs the same level three times a
 * day as three different classes, and offering the evening students a one-tap
 * join into the morning game would put a stranger on the leaderboard.
 *
 * The PIN still exists and still works — this is the shortcut for the students
 * whose class it obviously is, not a replacement for it.
 */
export async function joinableGameForStudent(student: {
  branchId: string | null;
  level: string;
  sessionSlot: string;
}) {
  if (!student.branchId) return null;

  return prisma.quizGame.findFirst({
    where: {
      branchId: student.branchId,
      level: student.level,
      sessionSlot: student.sessionSlot,
      ...joinableWhere(),
    },
    orderBy: { createdAt: "desc" },
    select: gameSelect,
  });
}

/** The columns every read of a game needs. Kept in one place so they cannot drift. */
export const gameSelect = {
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
  shuffled: true,
  assignmentId: true,
  lecturerId: true,
  hostUserId: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  liveSessionId: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const;
