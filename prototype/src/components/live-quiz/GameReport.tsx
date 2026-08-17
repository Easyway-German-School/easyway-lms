"use client";

/**
 * What the class actually got wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY THE QUESTIONS COME FIRST AND THE LEADERBOARD COMES SECOND
 * ---------------------------------------------------------------------------
 * Who won is the one fact from a quiz game that everybody already knows — the
 * room watched it happen on the podium ten minutes ago. What nobody in the room
 * could see is which question half the class fell over, and that is the only
 * thing on this screen that changes what a tutor teaches next.
 *
 * So the paper is the subject and the students are the appendix. Questions
 * arrive worst-answered first, and the ones nobody reached sort to the bottom
 * rather than the top: "0 of 0" is not the hardest question in the set.
 *
 * It is also honest about what it is not. Playing a game is not attendance —
 * a quiz can be played from a bedroom — so this reports who played and leaves
 * the register alone. See `quizReport` in lib/live-quiz-views.ts.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertIcon, CheckIcon, ClockIcon, UsersIcon } from "@/components/icons";

type ReportQuestion = {
  index: number;
  prompt: string;
  type: string;
  points: number;
  correctText: string | null;
  answered: number;
  correct: number;
  accuracy: number | null;
  averageSeconds: number | null;
};

type ReportPlayer = {
  studentId: string;
  name: string;
  score: number;
  correct: number;
  answered: number;
  bestStreak: number;
  place: number;
  accuracy: number;
};

type Report = {
  game: {
    id: string;
    title: string;
    pin: string;
    questionCount: number;
    playerCount: number;
    endedAt: string | null;
    secondsPerQuestion: number;
    speedBonus: boolean;
    liveSessionId: string | null;
  };
  questions: ReportQuestion[];
  players: ReportPlayer[];
  classAccuracy: number | null;
};

/** Below this, a question is worth going back over in class. */
const WEAK_ACCURACY = 60;

export default function GameReport({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/live-quiz/${gameId}/report`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not open that game");
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that game");
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-5">
        <p className="flex items-center gap-2 text-sm text-[var(--danger)]">
          <AlertIcon className="h-4 w-4" /> {error}
        </p>
        <button type="button" onClick={onClose} className="mt-3 text-sm text-[var(--muted)]">
          Back
        </button>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-[var(--muted)]">Loading the results…</p>;
  }

  const weak = report.questions.filter(
    (question) => question.accuracy !== null && question.accuracy < WEAK_ACCURACY,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--foreground)]">{report.game.title}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {report.game.endedAt ? new Date(report.game.endedAt).toLocaleString() : "In progress"} ·{" "}
            {report.game.playerCount} played · {report.game.questionCount} questions
            {report.game.liveSessionId ? " · played in a live lesson" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]"
        >
          Back
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Class accuracy" value={report.classAccuracy === null ? "—" : `${report.classAccuracy}%`} />
        <Stat label="Played" value={String(report.game.playerCount)} icon={<UsersIcon className="h-4 w-4" />} />
        <Stat label="Worth revising" value={String(weak.length)} />
      </div>

      {/* The headline, when there is one. A tutor who reads nothing else on this
          screen should still leave knowing which questions to go back over. */}
      {weak.length > 0 ? (
        <section className="rounded-2xl border border-[var(--warning)] bg-[var(--warning-soft)] p-5">
          <p className="text-sm font-bold text-[var(--foreground)]">
            {weak.length === 1 ? "One question to go back over" : `${weak.length} questions to go back over`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Fewer than {WEAK_ACCURACY}% of the answers were right.
          </p>
          <ul className="mt-3 space-y-2">
            {weak.map((question) => (
              <li key={question.index} className="text-sm text-[var(--foreground)]">
                <strong>{question.accuracy}%</strong> — {question.prompt}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Every question, hardest first
        </h3>
        <div className="space-y-2">
          {report.questions.map((question) => (
            <div
              key={question.index}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium text-[var(--foreground)]">
                  {question.prompt}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    question.accuracy === null
                      ? "bg-[var(--surface-alt)] text-[var(--muted)]"
                      : question.accuracy < WEAK_ACCURACY
                        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                        : "bg-[var(--success-soft)] text-[var(--success)]"
                  }`}
                >
                  {question.accuracy === null ? "not reached" : `${question.accuracy}%`}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                <span>
                  {question.correct} of {question.answered} right
                </span>
                {question.averageSeconds !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5" /> {question.averageSeconds}s average
                  </span>
                ) : null}
                {question.correctText ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckIcon className="h-3.5 w-3.5" /> {question.correctText}
                  </span>
                ) : null}
              </div>

              {question.answered > 0 ? (
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${question.accuracy ?? 0}%` }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Who played
        </h3>
        {/* Deliberately not called "attendance". A quiz can be played from a
            bedroom, and a register that quietly counts this as presence is a
            record the school could not defend. */}
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-[var(--surface-alt)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Right</th>
                <th className="px-3 py-2">Best run</th>
              </tr>
            </thead>
            <tbody>
              {report.players.map((player) => (
                <tr key={player.studentId} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-semibold text-[var(--muted)]">{player.place}</td>
                  <td className="px-3 py-2 font-medium text-[var(--foreground)]">{player.name}</td>
                  <td className="px-3 py-2 tabular-nums">{player.score.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {player.correct}/{report.game.questionCount}
                    <span className="ml-1 text-xs text-[var(--muted)]">({player.accuracy}%)</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{player.bestStreak}</td>
                </tr>
              ))}
              {report.players.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-[var(--muted)]">
                    Nobody joined this game.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--muted)]">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--foreground)]">{value}</p>
    </div>
  );
}
