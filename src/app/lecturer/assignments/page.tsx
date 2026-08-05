"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import QuestionBuilder, { emptyQuestion, draftToQuestion, type QuestionDraft } from "@/components/QuestionBuilder";
import StudentPicker from "@/components/StudentPicker";
import MarkingQueue from "@/components/MarkingQueue";
import { LEVELS } from "@/lib/levels";

/** Tutors set work here: a document to hand in, or a timed multiple-choice quiz. */

type Submission = {
  id: string;
  score: number | null;
  submittedAt: string | null;
  student: { studentCode: string | null; user: { name: string | null } };
};

type Assignment = {
  id: string;
  title: string;
  level: string;
  type: string;
  timeLimitMinutes: number | null;
  dueAt: string | null;
  branch: { name: string } | null;
  _count: { submissions: number };
  submissions: Submission[];
};

/* The question shape now lives with the builder, so the editor and the
   thing that serialises it cannot drift apart. */

export default function LecturerAssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("A1");
  const [type, setType] = useState("document");
  const [timeLimit, setTimeLimit] = useState(10);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [studentIds, setStudentIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/assignments", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load assignments");
      setAssignments(data.assignments ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/lecturer/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title, description, level, type,
          timeLimitMinutes: type === "quiz" ? timeLimit : null,
          questions: type === "quiz" ? questions.map(draftToQuestion) : undefined,
          studentIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create");

      setOpen(false);
      setTitle(""); setDescription("");
      setQuestions([emptyQuestion()]);
      setStudentIds([]);
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <LecturerShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Assignments</h1>
            <p className="mt-1 text-sm text-slate-500">
              Set a document to hand in, or a timed quiz that marks itself.
            </p>
          </div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
          >
            {open ? "Cancel" : "New assignment"}
          </button>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {/* Marking sits above the list on purpose: it is the thing with a
            student waiting at the other end of it. */}
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">To mark</h2>
          <MarkingQueue />
        </div>

        {open && (
          <div className="mb-8 rounded-xl border bg-white p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label className="sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Instructions</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label>
                <span className="text-xs font-medium text-slate-600">Level</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label>
                <span className="text-xs font-medium text-slate-600">Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="document">Document to hand in</option>
                  <option value="quiz">Timed quiz</option>
                </select>
              </label>

              {type === "quiz" && (
                <label>
                  <span className="text-xs font-medium text-slate-600">Time limit (minutes)</span>
                  <input type="number" min={1} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                </label>
              )}
            </div>

            {type === "quiz" && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-semibold">Questions</p>
                <QuestionBuilder questions={questions} onChange={setQuestions} />
              </div>
            )}

            {/* Targeting applies to written work as much as to quizzes — a
                make-up essay for two students is the same idea. */}
            <div className="mt-6">
              <StudentPicker level={level} selected={studentIds} onChange={setStudentIds} />
            </div>

            <button
              onClick={create}
              disabled={saving || !title.trim()}
              className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create assignment"}
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No assignments set yet.</div>
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => (
              <div key={a.id} className="rounded-xl border bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${a.type === "quiz" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                        {a.type}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{a.level}</span>
                      {a.timeLimitMinutes && <span className="text-xs text-amber-700">⏱ {a.timeLimitMinutes} min</span>}
                    </div>
                    <h3 className="mt-1.5 font-semibold">{a.title}</h3>
                  </div>
                  <p className="text-sm text-slate-500">
                    {a.submissions.length} submitted
                  </p>
                </div>

                {a.submissions.length > 0 && (
                  <div className="mt-3 space-y-1 border-t pt-3">
                    {a.submissions.slice(0, 5).map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm">
                        <span>
                          {s.student.user.name ?? "—"}
                          {s.student.studentCode && (
                            <span className="ml-2 font-mono text-xs text-slate-400">{s.student.studentCode}</span>
                          )}
                        </span>
                        <span className="font-semibold">{s.score ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </LecturerShell>
  );
}
