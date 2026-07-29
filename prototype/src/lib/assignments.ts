/**
 * Shared shapes and grading for assignments.
 *
 * The correct answers never leave the server for a quiz in progress — the
 * student payload strips `answerIndex`, so the answer key is not sitting in
 * the page source waiting to be read.
 */

export type QuizQuestion = {
  prompt: string;
  options: string[];
  answerIndex: number;
};

export type PublicQuizQuestion = {
  prompt: string;
  options: string[];
};

export function parseQuestions(value: unknown): QuizQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      prompt: String(q.prompt ?? ""),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : [],
      answerIndex: Number.isInteger(q.answerIndex) ? Number(q.answerIndex) : -1,
    }))
    .filter((q) => q.prompt && q.options.length >= 2);
}

/** Strip the answer key before sending a quiz to a student. */
export function toPublicQuestions(questions: QuizQuestion[]): PublicQuizQuestion[] {
  return questions.map(({ prompt, options }) => ({ prompt, options }));
}

export function gradeQuiz(questions: QuizQuestion[], answers: unknown): {
  score: number;
  correct: number;
  total: number;
} {
  const given = Array.isArray(answers) ? answers : [];
  const total = questions.length;
  if (total === 0) return { score: 0, correct: 0, total: 0 };

  let correct = 0;
  questions.forEach((q, i) => {
    if (Number(given[i]) === q.answerIndex) correct++;
  });

  return { score: Math.round((correct / total) * 100), correct, total };
}

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
