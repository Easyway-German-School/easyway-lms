import { editDistance } from "@/lib/fuzzy-match";

/**
 * Shared shapes and grading for assignments.
 *
 * The correct answers never leave the server for a quiz in progress — the
 * student payload strips every answer key, so nothing is sitting in the page
 * source waiting to be read. That rule is why `toPublicQuestions` rebuilds
 * each question field by field instead of deleting a few: adding a type
 * without deciding what a student may see should be a type error, not a
 * silent leak.
 */

/* -------------------------------------------------------------------------- */
/* Question types                                                             */
/* -------------------------------------------------------------------------- */

export const QUESTION_TYPES = ["choice", "multi", "boolean", "short", "paragraph"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  choice: "Multiple choice",
  multi: "Checkboxes (several correct)",
  boolean: "True or false",
  short: "Short answer",
  paragraph: "Written answer",
};

export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  choice: "One correct option. Marked automatically.",
  multi: "Several correct options. Marked automatically.",
  boolean: "Reads well for grammar rules. Marked automatically.",
  short: "A word or phrase the student types. Marked automatically.",
  paragraph: "Long-form writing. Comes to you to mark by hand.",
};

type QuestionBase = {
  prompt: string;
  /**
   * What this question is worth. Weighting matters in a language test: a
   * one-word vocabulary item and a paragraph of writing are not the same
   * achievement, and scoring them equally flatters the wrong student.
   */
  points: number;
};

export type ChoiceQuestion = QuestionBase & {
  type: "choice";
  options: string[];
  answerIndex: number;
};

export type MultiQuestion = QuestionBase & {
  type: "multi";
  options: string[];
  answerIndexes: number[];
  /**
   * With partial credit, marks are the proportion right with wrong ticks
   * subtracted, so ticking everything scores zero rather than full marks.
   * Without it, the question is all or nothing.
   */
  partialCredit: boolean;
};

export type BooleanQuestion = QuestionBase & {
  type: "boolean";
  answer: boolean;
};

export type ShortQuestion = QuestionBase & {
  type: "short";
  /** Any one of these counts as right. */
  accepted: string[];
  /** Off by default: "der" and "Der" are the same answer to most questions. */
  caseSensitive: boolean;
  /**
   * Forgive a single typo on answers long enough for it to be unambiguous.
   * Off by default, because on a spelling test it defeats the point.
   */
  allowTypos: boolean;
};

export type ParagraphQuestion = QuestionBase & {
  type: "paragraph";
  /** Shown to the tutor while marking, never to the student. */
  guidance?: string;
};

export type Question =
  | ChoiceQuestion
  | MultiQuestion
  | BooleanQuestion
  | ShortQuestion
  | ParagraphQuestion;

/** What a student is allowed to see: the question minus any answer key. */
export type PublicQuestion =
  | { type: "choice"; prompt: string; points: number; options: string[] }
  | { type: "multi"; prompt: string; points: number; options: string[] }
  | { type: "boolean"; prompt: string; points: number }
  | { type: "short"; prompt: string; points: number }
  | { type: "paragraph"; prompt: string; points: number };

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "")) : [];
}

function asPoints(value: unknown): number {
  const points = Number(value);
  // Anything unreadable is worth one mark rather than zero: a question that
  // silently counts for nothing is worse than one weighted plainly.
  if (!Number.isFinite(points) || points <= 0) return 1;
  return Math.min(Math.round(points), 100);
}

/**
 * Read questions out of the JSON column, discarding anything malformed.
 *
 * Tolerant on purpose. This is stored JSON that has already been through one
 * schema in production, and a single bad row must degrade to "that question is
 * missing" rather than taking down every assignment page in the school.
 *
 * A question with no `type` is read as multiple choice. That is not a guess —
 * it is the exact shape every assignment written before this used, and they
 * have to keep working untouched.
 */
export function parseQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];

  const out: Question[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;

    const prompt = String(q.prompt ?? "").trim();
    if (!prompt) continue;

    const points = asPoints(q.points);
    const declared = String(q.type ?? "").trim();
    const type = (QUESTION_TYPES as readonly string[]).includes(declared) ? declared : "choice";

    if (type === "choice") {
      const options = asStringArray(q.options).filter((option) => option.trim());
      if (options.length < 2) continue;
      const answerIndex = Number.isInteger(q.answerIndex) ? Number(q.answerIndex) : -1;
      if (answerIndex < 0 || answerIndex >= options.length) continue;
      out.push({ type: "choice", prompt, points, options, answerIndex });
      continue;
    }

    if (type === "multi") {
      const options = asStringArray(q.options).filter((option) => option.trim());
      if (options.length < 2) continue;
      const answerIndexes = (Array.isArray(q.answerIndexes) ? q.answerIndexes : [])
        .map((index) => Number(index))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length);
      if (answerIndexes.length === 0) continue;
      out.push({
        type: "multi",
        prompt,
        points,
        options,
        answerIndexes: [...new Set(answerIndexes)].sort((a, b) => a - b),
        partialCredit: q.partialCredit !== false,
      });
      continue;
    }

    if (type === "boolean") {
      out.push({ type: "boolean", prompt, points, answer: q.answer === true });
      continue;
    }

    if (type === "short") {
      const accepted = asStringArray(q.accepted)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (accepted.length === 0) continue;
      out.push({
        type: "short",
        prompt,
        points,
        accepted,
        caseSensitive: q.caseSensitive === true,
        allowTypos: q.allowTypos === true,
      });
      continue;
    }

    if (type === "paragraph") {
      const guidance = String(q.guidance ?? "").trim();
      out.push({ type: "paragraph", prompt, points, ...(guidance ? { guidance } : {}) });
    }
  }

  return out;
}

/**
 * Strip every answer key before a quiz reaches a student.
 *
 * Rebuilt field by field rather than spread-and-delete. A spread would carry
 * anything added later — including the next answer key somebody introduces —
 * out to the browser by default, and that failure stays invisible until a
 * student opens dev tools.
 */
export function toPublicQuestions(questions: Question[]): PublicQuestion[] {
  return questions.map((question) => {
    switch (question.type) {
      case "choice":
        return { type: "choice", prompt: question.prompt, points: question.points, options: question.options };
      case "multi":
        return { type: "multi", prompt: question.prompt, points: question.points, options: question.options };
      case "boolean":
        return { type: "boolean", prompt: question.prompt, points: question.points };
      case "short":
        return { type: "short", prompt: question.prompt, points: question.points };
      case "paragraph":
        return { type: "paragraph", prompt: question.prompt, points: question.points };
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Short-answer matching                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Umlauts are NOT folded away, and that is the entire point.
 *
 * The obvious move is to reuse `normaliseKey` from the fuzzy-match library,
 * which strips accents so `Köln` and `Koln` collapse together. For matching a
 * branch name that is right. For marking a German test it is wrong: `schon`
 * and `schön` are different words, and a marker that cannot tell them apart
 * awards marks for the exact mistake the exercise exists to catch.
 *
 * What IS accepted is the transliteration Germans genuinely use on a keyboard
 * without umlauts — ue, oe, ae, ss. A student typing `schoen` has spelled it
 * correctly. A student typing `schon` has not.
 */
function germanNormalise(value: string, caseSensitive: boolean): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  const cased = caseSensitive ? collapsed : collapsed.toLowerCase();
  return cased
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    // Trailing punctuation a student may or may not have bothered with.
    .replace(/[.,!?;:]+$/g, "");
}

export function shortAnswerMatches(given: string, question: ShortQuestion): boolean {
  const answer = germanNormalise(given, question.caseSensitive);
  if (!answer) return false;

  for (const candidate of question.accepted) {
    const target = germanNormalise(candidate, question.caseSensitive);
    if (answer === target) return true;

    // One typo forgiven, and only on words long enough that a single edit
    // cannot turn one real answer into a different real one. At three letters
    // `der`, `die` and `das` are each one edit apart, which would make a
    // grammar question meaningless.
    if (question.allowTypos && target.length >= 5 && editDistance(answer, target, 1) <= 1) {
      return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

export type QuestionResult = {
  /** Marks awarded, or null while a written answer waits for a human. */
  earned: number | null;
  possible: number;
  /** null means "not marked yet" rather than "wrong". */
  correct: boolean | null;
  needsReview: boolean;
};

export type GradeResult = {
  results: QuestionResult[];
  earned: number;
  possible: number;
  /**
   * Percentage over the AUTO-MARKED questions only, or null when there are
   * none. Never a percentage of the whole paper while marks are outstanding —
   * that would show a student 40% on a test nobody has finished marking, which
   * reads as a fail.
   */
  score: number | null;
  needsReview: boolean;
  autoMarked: number;
  awaitingReview: number;
};

/**
 * Mark a submission against its questions.
 *
 * `answers` is positional, matching `questions`. The shape at each slot
 * depends on the type: a number for choice, an array of numbers for multi, a
 * boolean for true/false, a string for short and paragraph.
 */
export function gradeSubmission(questions: Question[], answers: unknown): GradeResult {
  const given = Array.isArray(answers) ? answers : [];
  const results: QuestionResult[] = [];

  let earned = 0;
  let possible = 0;
  let autoPossible = 0;
  let awaitingReview = 0;
  let autoMarked = 0;

  questions.forEach((question, index) => {
    const answer = given[index];
    possible += question.points;

    if (question.type === "paragraph") {
      awaitingReview += 1;
      results.push({ earned: null, possible: question.points, correct: null, needsReview: true });
      return;
    }

    autoPossible += question.points;
    autoMarked += 1;

    let awarded = 0;

    switch (question.type) {
      case "choice":
        awarded = Number(answer) === question.answerIndex ? question.points : 0;
        break;

      case "boolean":
        awarded = answer === question.answer ? question.points : 0;
        break;

      case "short":
        awarded = typeof answer === "string" && shortAnswerMatches(answer, question) ? question.points : 0;
        break;

      case "multi": {
        const picked = new Set(
          (Array.isArray(answer) ? answer : []).map((value) => Number(value)).filter(Number.isInteger),
        );
        const correctSet = new Set(question.answerIndexes);
        const hits = [...picked].filter((index) => correctSet.has(index)).length;
        const misses = [...picked].filter((index) => !correctSet.has(index)).length;

        if (question.partialCredit) {
          // Wrong ticks cancel right ones, so selecting every option scores
          // nothing instead of full marks. Floored at zero — a bad guess on
          // one question must never eat marks earned on another.
          const net = Math.max(0, hits - misses);
          awarded = Math.round((net / correctSet.size) * question.points);
        } else {
          awarded = hits === correctSet.size && misses === 0 ? question.points : 0;
        }
        break;
      }
    }

    earned += awarded;
    results.push({
      earned: awarded,
      possible: question.points,
      correct: awarded === question.points,
      needsReview: false,
    });
  });

  return {
    results,
    earned,
    possible,
    score: autoPossible > 0 ? Math.round((earned / autoPossible) * 100) : null,
    needsReview: awaitingReview > 0,
    autoMarked,
    awaitingReview,
  };
}

/**
 * Fold a tutor's hand marks into an auto-marked submission and produce the
 * final percentage, this time over the whole paper.
 *
 * `manual` is positional like `answers`; entries at non-paragraph slots are
 * ignored, and a mark above what the question is worth is clamped rather than
 * trusted.
 */
export function finaliseScore(
  questions: Question[],
  autoResults: QuestionResult[],
  manual: unknown,
): { score: number; earned: number; possible: number } {
  const marks = Array.isArray(manual) ? manual : [];
  let earned = 0;
  let possible = 0;

  questions.forEach((question, index) => {
    possible += question.points;

    if (question.type === "paragraph") {
      const mark = Number(marks[index]);
      earned += Number.isFinite(mark) ? Math.max(0, Math.min(mark, question.points)) : 0;
      return;
    }

    earned += autoResults[index]?.earned ?? 0;
  });

  return {
    score: possible > 0 ? Math.round((earned / possible) * 100) : 0,
    earned,
    possible,
  };
}

/** The marks a paper is out of, for display next to the title. */
export function totalPoints(questions: Question[]): number {
  return questions.reduce((sum, question) => sum + question.points, 0);
}

/* -------------------------------------------------------------------------- */
/* Timing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether a timed quiz has run out, based on the server-recorded start.
 * A missing time limit means untimed.
 */
export function deadlineFor(startedAt: Date | null, timeLimitMinutes: number | null): Date | null {
  if (!startedAt || !timeLimitMinutes) return null;
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

export function isExpired(startedAt: Date | null, timeLimitMinutes: number | null, now = new Date()): boolean {
  const deadline = deadlineFor(startedAt, timeLimitMinutes);
  return Boolean(deadline && now > deadline);
}

/* -------------------------------------------------------------------------- */
/* Back-compat                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The previous grader, kept because callers still use it. It delegates, so
 * there is one set of marking rules rather than two that drift apart.
 */
export function gradeQuiz(
  questions: Question[],
  answers: unknown,
): { score: number; correct: number; total: number } {
  const result = gradeSubmission(questions, answers);
  return {
    score: result.score ?? 0,
    correct: result.results.filter((entry) => entry.correct === true).length,
    total: questions.length,
  };
}

/** Old names, so existing imports keep compiling. */
export type QuizQuestion = Question;
export type PublicQuizQuestion = PublicQuestion;
