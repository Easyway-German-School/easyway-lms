"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Assignments for a student: documents to hand in, and timed quizzes.
 *
 * The countdown here is a display of the server's deadline, not the authority
 * on it. The server stamps startedAt and decides what counts as late, so a
 * reload or a changed device clock gains nothing. When the clock hits zero the
 * answers so far are submitted automatically rather than lost.
 */

type Submission = {
  submittedAt: string | null;
  score: number | null;
  feedback: string | null;
  startedAt: string | null;
  deadline: string | null;
  expired: boolean;
};

type Assignment = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  timeLimitMinutes: number | null;
  questionCount: number;
  dueAt: string | null;
  lecturerName: string | null;
  submission: Submission | null;
};

type Question = { prompt: string; options: string[] };

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function AssignmentsPanel() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [active, setActive] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [docText, setDocText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/student/assignments", { cache: "no-store" });
      if (!res.ok) throw new Error("Unable to load assignments");
      const data = await res.json();
      setAssignments(data.assignments ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Guards against the auto-submit firing twice as the clock crosses zero.
  const submittingRef = useRef(false);

  const submit = useCallback(async (auto = false) => {
    if (!active || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);

    try {
      const res = await fetch("/api/student/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignmentId: active.id,
          action: "submit",
          answers: active.type === "quiz" ? answers : undefined,
          text: active.type === "document" ? docText : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not submit");

      setActive(null);
      setDeadline(null);
      setDocText("");
      await load();
      if (auto) setError("Time ran out — your answers were submitted automatically.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }, [active, answers, docText, load]);

  // Tick the countdown and auto-submit at zero.
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        void submit(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, submit]);

  async function open(assignment: Assignment) {
    setBusy(true);
    setError("");
    try {
      if (assignment.type === "quiz") {
        const res = await fetch("/api/student/assignments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assignmentId: assignment.id, action: "start" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not open this quiz");

        setQuestions(data.questions ?? []);
        setAnswers(new Array((data.questions ?? []).length).fill(-1));
        setDeadline(data.deadline ? new Date(data.deadline).getTime() : null);
        if (data.deadline) setRemaining(new Date(data.deadline).getTime() - Date.now());
      }
      setActive(assignment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-3xl bg-slate-200/60" />)}</div>;
  }

  // ---- Taking a quiz -------------------------------------------------------
  if (active && active.type === "quiz") {
    const answered = answers.filter((a) => a >= 0).length;
    const low = remaining > 0 && remaining < 60_000;

    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div>
            <h2 className="text-lg font-bold">{active.title}</h2>
            <p className="text-xs text-[var(--muted)]">{answered} of {questions.length} answered</p>
          </div>
          {deadline && (
            <div className={`rounded-2xl px-4 py-2 text-center ${low ? "bg-red-100 text-red-700" : "bg-[var(--surface-alt)]"}`}>
              <p className="text-[10px] uppercase tracking-[0.2em]">Time left</p>
              <p className="font-mono text-xl font-bold">{formatRemaining(remaining)}</p>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-5">
          {questions.map((q, qi) => (
            <div key={qi} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
              <p className="text-sm font-semibold">{qi + 1}. {q.prompt}</p>
              <div className="mt-3 space-y-2">
                {q.options.map((opt, oi) => (
                  <label key={oi} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${
                    answers[qi] === oi ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--surface)]"
                  }`}>
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => setAnswers((prev) => prev.map((v, i) => (i === qi ? oi : v)))}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => submit(false)}
            disabled={busy}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Submit answers"}
          </button>
          <button onClick={() => { setActive(null); setDeadline(null); }} className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold">
            Back
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Your clock keeps running if you leave this page — the time limit is held on the server.
        </p>
      </div>
    );
  }

  // ---- Handing in a document ----------------------------------------------
  if (active && active.type === "document") {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-bold">{active.title}</h2>
        {active.description && <p className="mt-1 text-sm text-[var(--muted)]">{active.description}</p>}

        <textarea
          value={docText}
          onChange={(e) => setDocText(e.target.value)}
          rows={10}
          placeholder="Type or paste your work here…"
          className="mt-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm"
        />

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => submit(false)}
            disabled={busy || !docText.trim()}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Hand in"}
          </button>
          <button onClick={() => setActive(null)} className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold">
            Back
          </button>
        </div>
      </div>
    );
  }

  // ---- List ----------------------------------------------------------------
  return (
    <div className="space-y-4">
      {error && <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">{error}</div>}

      {assignments.length === 0 ? (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
          <div className="text-4xl">✍️</div>
          <p className="mt-3 text-sm font-semibold">No assignments yet</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Work set by your tutor will appear here.</p>
        </div>
      ) : (
        assignments.map((a) => {
          const done = Boolean(a.submission?.submittedAt);
          return (
            <div key={a.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      a.type === "quiz" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    }`}>
                      {a.type}
                    </span>
                    {a.timeLimitMinutes && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        ⏱ {a.timeLimitMinutes} MIN
                      </span>
                    )}
                    {done && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        SUBMITTED
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{a.title}</h3>
                  {a.description && <p className="mt-1 text-sm text-[var(--muted)]">{a.description}</p>}
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {a.type === "quiz" && `${a.questionCount} questions`}
                    {a.dueAt && ` · due ${new Date(a.dueAt).toLocaleDateString()}`}
                    {a.lecturerName && ` · set by ${a.lecturerName}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {done ? (
                    a.submission?.score !== null && a.submission?.score !== undefined ? (
                      <>
                        <p className="text-2xl font-bold">{a.submission.score}</p>
                        <p className="text-[11px] text-[var(--muted)]">score</p>
                      </>
                    ) : (
                      <p className="text-xs text-[var(--muted)]">Awaiting marking</p>
                    )
                  ) : (
                    <button
                      onClick={() => open(a)}
                      disabled={busy}
                      className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {a.type === "quiz" ? "Start" : "Open"}
                    </button>
                  )}
                </div>
              </div>

              {done && a.submission?.feedback && (
                <p className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3 text-sm text-[var(--muted)]">
                  {a.submission.feedback}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
