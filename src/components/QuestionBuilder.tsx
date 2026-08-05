"use client";

import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_HINTS,
  type QuestionType,
} from "@/lib/assignments";

/**
 * The question editor — the form-software half of setting an online test.
 *
 * Each question carries its own type, picked from a dropdown the way Google
 * Forms does it, so one paper can mix a vocabulary item, a grammar
 * true/false and a paragraph of writing. Changing the type keeps the wording
 * and the marks and swaps only the answer editor underneath, because
 * discovering the type is wrong should not cost you the question you just
 * typed.
 *
 * Deliberately dumb: it holds no state of its own and does no validation
 * beyond disabling impossible buttons. The server re-checks everything —
 * a browser is not where correctness lives.
 */

/** The editing shape: every field any type might need, all optional. */
export type QuestionDraft = {
  type: QuestionType;
  prompt: string;
  points: number;
  options: string[];
  answerIndex: number;
  answerIndexes: number[];
  partialCredit: boolean;
  answer: boolean;
  accepted: string[];
  caseSensitive: boolean;
  allowTypos: boolean;
  guidance: string;
};

export function emptyQuestion(): QuestionDraft {
  return {
    type: "choice",
    prompt: "",
    points: 1,
    options: ["", ""],
    answerIndex: 0,
    answerIndexes: [],
    partialCredit: true,
    answer: true,
    accepted: [""],
    caseSensitive: false,
    allowTypos: false,
    guidance: "",
  };
}

/**
 * Trim the draft down to just the fields its type actually uses.
 *
 * Without this a question that started as multiple choice and became a short
 * answer would still be carrying its old options and answerIndex, and the
 * parser would have to guess which of the two answer keys was meant.
 */
export function draftToQuestion(draft: QuestionDraft) {
  const base = { type: draft.type, prompt: draft.prompt.trim(), points: draft.points };

  switch (draft.type) {
    case "choice":
      return { ...base, options: draft.options, answerIndex: draft.answerIndex };
    case "multi":
      return { ...base, options: draft.options, answerIndexes: draft.answerIndexes, partialCredit: draft.partialCredit };
    case "boolean":
      return { ...base, answer: draft.answer };
    case "short":
      return {
        ...base,
        accepted: draft.accepted.filter((entry) => entry.trim()),
        caseSensitive: draft.caseSensitive,
        allowTypos: draft.allowTypos,
      };
    case "paragraph":
      return { ...base, guidance: draft.guidance.trim() || undefined };
  }
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

export default function QuestionBuilder({
  questions,
  onChange,
}: {
  questions: QuestionDraft[];
  onChange: (next: QuestionDraft[]) => void;
}) {
  const patch = (index: number, changes: Partial<QuestionDraft>) =>
    onChange(questions.map((q, i) => (i === index ? { ...q, ...changes } : q)));

  const remove = (index: number) => onChange(questions.filter((_, i) => i !== index));

  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {questions.length} question{questions.length === 1 ? "" : "s"} · {totalMarks} mark{totalMarks === 1 ? "" : "s"}
        </p>
      </div>

      {questions.map((question, index) => (
        <div key={index} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
          {/* Header: number, type, marks, reorder, delete */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-bold text-[var(--accent)]">
              {index + 1}
            </span>

            <select
              value={question.type}
              onChange={(event) => patch(index, { type: event.target.value as QuestionType })}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs font-medium"
            >
              {QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {QUESTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
              <input
                type="number"
                min={1}
                max={100}
                value={question.points}
                onChange={(event) => patch(index, { points: Math.max(1, Number(event.target.value) || 1) })}
                className="w-14 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-center text-xs"
              />
              marks
            </label>

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                className="rounded px-2 py-1 text-xs disabled:opacity-30" title="Move up">↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === questions.length - 1}
                className="rounded px-2 py-1 text-xs disabled:opacity-30" title="Move down">↓</button>
              <button type="button" onClick={() => remove(index)} disabled={questions.length === 1}
                className="rounded px-2 py-1 text-xs text-red-600 disabled:opacity-30" title="Delete">✕</button>
            </div>
          </div>

          <p className="mb-2 text-[11px] text-[var(--muted)]">{QUESTION_TYPE_HINTS[question.type]}</p>

          <input
            value={question.prompt}
            onChange={(event) => patch(index, { prompt: event.target.value })}
            placeholder="Type the question…"
            className={`${inputClass} mb-3 font-medium`}
          />

          {/* ---- the answer editor, per type ---- */}

          {(question.type === "choice" || question.type === "multi") && (
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <input
                    // Radio for one answer, checkbox for several — the control
                    // itself tells the tutor how many they may tick.
                    type={question.type === "choice" ? "radio" : "checkbox"}
                    name={`q-${index}-answer`}
                    checked={
                      question.type === "choice"
                        ? question.answerIndex === optionIndex
                        : question.answerIndexes.includes(optionIndex)
                    }
                    onChange={() =>
                      question.type === "choice"
                        ? patch(index, { answerIndex: optionIndex })
                        : patch(index, {
                            answerIndexes: question.answerIndexes.includes(optionIndex)
                              ? question.answerIndexes.filter((i) => i !== optionIndex)
                              : [...question.answerIndexes, optionIndex].sort((a, b) => a - b),
                          })
                    }
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <input
                    value={option}
                    onChange={(event) =>
                      patch(index, {
                        options: question.options.map((o, i) => (i === optionIndex ? event.target.value : o)),
                      })
                    }
                    placeholder={`Option ${optionIndex + 1}`}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch(index, {
                        options: question.options.filter((_, i) => i !== optionIndex),
                        // Removing an option shifts everything after it, so the
                        // stored answer indexes have to shift with it or the
                        // answer key silently points at the wrong option.
                        answerIndex:
                          question.answerIndex > optionIndex
                            ? question.answerIndex - 1
                            : Math.min(question.answerIndex, question.options.length - 2),
                        answerIndexes: question.answerIndexes
                          .filter((i) => i !== optionIndex)
                          .map((i) => (i > optionIndex ? i - 1 : i)),
                      })
                    }
                    disabled={question.options.length <= 2}
                    className="shrink-0 rounded px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => patch(index, { options: [...question.options, ""] })}
                className="text-xs font-semibold text-[var(--accent)]"
              >
                + Add option
              </button>

              {question.type === "multi" && (
                <label className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={question.partialCredit}
                    onChange={(event) => patch(index, { partialCredit: event.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Give part marks for a partly right answer
                </label>
              )}
            </div>
          )}

          {question.type === "boolean" && (
            <div className="flex gap-2">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => patch(index, { answer: value })}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                    question.answer === value
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {value ? "True is correct" : "False is correct"}
                </button>
              ))}
            </div>
          )}

          {question.type === "short" && (
            <div className="space-y-2">
              {question.accepted.map((accepted, acceptedIndex) => (
                <div key={acceptedIndex} className="flex items-center gap-2">
                  <input
                    value={accepted}
                    onChange={(event) =>
                      patch(index, {
                        accepted: question.accepted.map((a, i) => (i === acceptedIndex ? event.target.value : a)),
                      })
                    }
                    placeholder={acceptedIndex === 0 ? "Correct answer" : "Also accept…"}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => patch(index, { accepted: question.accepted.filter((_, i) => i !== acceptedIndex) })}
                    disabled={question.accepted.length <= 1}
                    className="shrink-0 rounded px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => patch(index, { accepted: [...question.accepted, ""] })}
                className="text-xs font-semibold text-[var(--accent)]"
              >
                + Accept another spelling
              </button>

              <div className="space-y-1 pt-1">
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input type="checkbox" checked={question.caseSensitive}
                    onChange={(event) => patch(index, { caseSensitive: event.target.checked })}
                    className="accent-[var(--accent)]" />
                  Capital letters must match (for nouns)
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input type="checkbox" checked={question.allowTypos}
                    onChange={(event) => patch(index, { allowTypos: event.target.checked })}
                    className="accent-[var(--accent)]" />
                  Forgive one typo — leave off for a spelling test
                </label>
              </div>

              <p className="rounded-lg bg-[var(--surface)] p-2 text-[11px] leading-4 text-[var(--muted)]">
                <strong>schoen</strong> is accepted for <strong>schön</strong> automatically — students without
                an umlaut keyboard are not penalised. <strong>schon</strong> is still marked wrong.
              </p>
            </div>
          )}

          {question.type === "paragraph" && (
            <div className="space-y-2">
              <p className="rounded-lg bg-amber-50 p-2 text-[11px] leading-4 text-amber-900">
                You will mark this one by hand. The student sees no score until you have.
              </p>
              <input
                value={question.guidance}
                onChange={(event) => patch(index, { guidance: event.target.value })}
                placeholder="Note to yourself for marking (the student never sees this)"
                className={inputClass}
              />
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...questions, emptyQuestion()])}
        className="w-full rounded-xl border border-dashed border-[var(--border)] py-3 text-sm font-semibold text-[var(--accent)]"
      >
        + Add question
      </button>
    </div>
  );
}
