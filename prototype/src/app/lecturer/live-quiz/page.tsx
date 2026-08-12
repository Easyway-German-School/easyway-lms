"use client";

/**
 * Set a game up, then get out of the way.
 *
 * The whole screen is one decision — which quiz — followed by three settings a
 * tutor might want to change and usually will not. Everything past "Start"
 * belongs to the projector, which takes over the display entirely.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LecturerShell from "@/components/LecturerShell";
import HostGame from "@/components/live-quiz/HostGame";
import { AlertIcon, ClockIcon, FlameIcon, PlayIcon, QuizIcon, RefreshIcon } from "@/components/icons";

type Quiz = {
  id: string;
  title: string;
  level: string;
  branchName: string | null;
  questionCount: number;
  droppedCount: number;
};

type OpenGame = { id: string; pin: string; title: string; phase: string };

const SECOND_CHOICES = [10, 20, 30, 45, 60];

export default function LiveQuizPage() {
  const { status } = useSession();
  const router = useRouter();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [openGame, setOpenGame] = useState<OpenGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<string>("");
  const [seconds, setSeconds] = useState(20);
  const [speedBonus, setSpeedBonus] = useState(true);
  const [shuffle, setShuffle] = useState(true);
  const [starting, setStarting] = useState(false);

  /** Non-null while the projector view owns the screen. */
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/live-quiz", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load your quizzes");
      const data = await res.json();
      setQuizzes(data.quizzes ?? []);
      setOpenGame(data.openGame ?? null);
      setSelected((current) => current || data.quizzes?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/lecturer/signin");
    if (status === "authenticated") void load();
  }, [status, router, load]);

  async function start() {
    if (!selected || starting) return;
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/live-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: selected, secondsPerQuestion: seconds, speedBonus, shuffle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start the game");
      setRunningId(data.game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the game");
    } finally {
      setStarting(false);
    }
  }

  const chosen = quizzes.find((quiz) => quiz.id === selected);

  return (
    <LecturerShell>
      {runningId ? (
        <HostGame
          gameId={runningId}
          onClose={() => {
            setRunningId(null);
            void load();
          }}
        />
      ) : null}

      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            <QuizIcon className="h-7 w-7 text-[var(--accent)]" />
            Quiz game
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Put a question on the board, and the class answers on their phones against a
            countdown. Faster right answers score more. Works in the classroom — nobody
            needs to be in a video call.
          </p>
        </header>

        {error ? (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <AlertIcon className="h-4 w-4" /> {error}
          </p>
        ) : null}

        {/* A game left open on a laptop that got shut is the failure this
            catches: the tutor comes back, sees it, and can walk straight into
            it instead of starting a second one the class is not in. */}
        {openGame ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-alt)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                You already have a game open — {openGame.title}
              </p>
              <p className="text-xs text-[var(--muted)]">
                PIN {openGame.pin} · {openGame.phase}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRunningId(openGame.id)}
              className="rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white"
            >
              Back to it
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading your quizzes…</p>
        ) : quizzes.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--foreground)]">
              You have no quizzes to play yet.
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              A game is built from a quiz you have already written. Create one under
              Assignments — pick <strong>Quiz</strong> as the type — and it will appear here.
              Written-answer questions are left out, because nothing can mark an essay
              against a countdown.
            </p>
            <a
              href="/lecturer/assignments"
              className="mt-4 inline-block rounded-lg bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white"
            >
              Go to assignments
            </a>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Which quiz
                </h2>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <RefreshIcon className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto">
                {quizzes.map((quiz) => (
                  <label
                    key={quiz.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                      selected === quiz.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="quiz"
                      value={quiz.id}
                      checked={selected === quiz.id}
                      onChange={() => setSelected(quiz.id)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--foreground)]">
                        {quiz.title}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {quiz.level}
                        {quiz.branchName ? ` · ${quiz.branchName}` : ""} · {quiz.questionCount}{" "}
                        question{quiz.questionCount === 1 ? "" : "s"}
                        {quiz.droppedCount > 0
                          ? ` · ${quiz.droppedCount} written answer${
                              quiz.droppedCount === 1 ? "" : "s"
                            } left out`
                          : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                How it plays
              </h2>

              <div className="space-y-4">
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                    <ClockIcon className="h-4 w-4" /> Seconds per question
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SECOND_CHOICES.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        onClick={() => setSeconds(choice)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                          seconds === choice
                            ? "bg-[var(--accent-strong)] text-white"
                            : "border border-[var(--border)] text-[var(--foreground)]"
                        }`}
                      >
                        {choice}s
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={speedBonus}
                    onChange={(event) => setSpeedBonus(event.target.checked)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                      <FlameIcon className="h-4 w-4" /> Faster answers score more
                    </span>
                    {/* Said plainly because it is the setting that decides who
                        can win. A slower group plays a fairer game with it off,
                        and a tutor who does not know that will never turn it
                        off. */}
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      On, the quickest correct answer is worth twice the slowest. Turn it off
                      for a group who are still translating in their heads — otherwise the
                      same three students win every time.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={shuffle}
                    onChange={(event) => setShuffle(event.target.checked)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      Shuffle the questions and the options
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      Worth leaving on if the class has played this paper before — otherwise
                      &ldquo;it&rsquo;s the blue one&rdquo; travels the room in four seconds.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <button
              type="button"
              onClick={() => void start()}
              disabled={!selected || starting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white disabled:opacity-50"
            >
              <PlayIcon className="h-5 w-5" />
              {starting
                ? "Starting…"
                : chosen
                  ? `Put ${chosen.questionCount} question${
                      chosen.questionCount === 1 ? "" : "s"
                    } on the board`
                  : "Start"}
            </button>

            <p className="text-center text-xs text-[var(--muted)]">
              The next screen is the one to project. Students open the app, tap{" "}
              <strong>Quiz game</strong>, and enter the PIN.
            </p>
          </div>
        )}
      </div>
    </LecturerShell>
  );
}
