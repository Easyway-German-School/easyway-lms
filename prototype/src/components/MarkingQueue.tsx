"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Written answers waiting for a human.
 *
 * Shows only the questions that actually need marking — the auto-marked ones
 * are already settled and would be noise. The tutor's own guidance note sits
 * beside each answer, because the thing you meant to look for is exactly what
 * you have forgotten by the time thirty papers come back.
 *
 * Nothing here is partly saveable: a paper is marked or it is not. Releasing
 * marks question by question would let a student refresh into a half-finished
 * result, which is the situation the whole needsReview flag exists to avoid.
 */

type ToMark = {
  index: number;
  prompt: string;
  points: number;
  guidance: string | null;
  answer: string;
};

type Pending = {
  id: string;
  submittedAt: string | null;
  student: { name: string | null; studentCode: string | null; level: string };
  assignment: { id: string; title: string };
  toMark: ToMark[];
  autoEarned: number;
};

export default function MarkingQueue({ assignmentId }: { assignmentId?: string }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Record<string, Record<number, string>>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const query = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : "";
      const response = await fetch(`/api/lecturer/assignments/mark${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the marking queue");
      setPending(data.submissions ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function release(submission: Pending) {
    setBusy(submission.id);
    try {
      // Positional, matching the question order the server graded against.
      const positioned: (number | null)[] = [];
      for (const item of submission.toMark) {
        positioned[item.index] = Number(marks[submission.id]?.[item.index] ?? 0);
      }

      const response = await fetch("/api/lecturer/assignments/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: submission.id,
          marks: positioned,
          feedback: feedback[submission.id] ?? "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the marks");

      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the marks");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading the marking queue…</p>;

  if (pending.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm font-semibold">Nothing waiting to be marked</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Written answers appear here the moment a student hands one in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {pending.length} paper{pending.length === 1 ? "" : "s"} waiting
      </p>

      {pending.map((submission) => {
        const outstanding = submission.toMark.reduce((sum, item) => sum + item.points, 0);
        const awarded = submission.toMark.reduce(
          (sum, item) => sum + (Number(marks[submission.id]?.[item.index]) || 0),
          0,
        );

        return (
          <div key={submission.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
              <div>
                <p className="text-sm font-bold">{submission.student.name ?? "Unnamed student"}</p>
                <p className="text-xs text-[var(--muted)]">
                  {submission.assignment.title} · {submission.student.level}
                  {submission.student.studentCode ? ` · ${submission.student.studentCode}` : ""}
                </p>
              </div>
              <div className="text-right text-xs text-[var(--muted)]">
                <p>{submission.autoEarned} marks auto-scored</p>
                <p className="font-semibold text-[var(--foreground)]">
                  {awarded} / {outstanding} being awarded here
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {submission.toMark.map((item) => (
                <div key={item.index} className="rounded-xl bg-[var(--surface-alt)] p-4">
                  <p className="text-sm font-semibold">{item.prompt}</p>

                  {item.guidance && (
                    <p className="mt-1 text-[11px] italic text-[var(--muted)]">
                      Your note: {item.guidance}
                    </p>
                  )}

                  <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-6">
                    {item.answer.trim() || <span className="text-[var(--muted)]">— left blank —</span>}
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-[var(--muted)]">Marks</span>
                    <input
                      type="number"
                      min={0}
                      max={item.points}
                      value={marks[submission.id]?.[item.index] ?? ""}
                      onChange={(event) =>
                        setMarks((prev) => ({
                          ...prev,
                          [submission.id]: { ...prev[submission.id], [item.index]: event.target.value },
                        }))
                      }
                      className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-center"
                    />
                    <span className="text-[var(--muted)]">out of {item.points}</span>
                  </label>
                </div>
              ))}
            </div>

            <textarea
              value={feedback[submission.id] ?? ""}
              onChange={(event) => setFeedback((prev) => ({ ...prev, [submission.id]: event.target.value }))}
              rows={2}
              placeholder="Feedback for the student (optional)"
              className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
            />

            <button
              onClick={() => release(submission)}
              disabled={busy === submission.id}
              className="mt-3 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy === submission.id ? "Saving…" : "Release result"}
            </button>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              The student sees no score until you do this — then the whole paper is scored at once.
            </p>
          </div>
        );
      })}
    </div>
  );
}
