"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import QuestionBuilder, { emptyQuestion, draftToQuestion, type QuestionDraft } from "@/components/QuestionBuilder";
import StudentPicker from "@/components/StudentPicker";
import MarkingQueue from "@/components/MarkingQueue";
import { LEVELS } from "@/lib/levels";
import { QUESTION_TYPE_LABELS, type Question } from "@/lib/assignments";

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
  description: string | null;
  level: string;
  type: string;
  timeLimitMinutes: number | null;
  dueAt: string | null;
  questions: Question[] | null;
  branch: { name: string } | null;
  _count: { submissions: number };
  submissions: Submission[];
  awaitingMarking: number;
};

type ScopeOption = {
  key: string;
  branchId: string;
  branchName: string;
  level: string;
  sessionSlot: string | null;
  batch: string | null;
  label: string;
};

/** A plain-language summary of one question's answer key, for a tutor
 *  re-reading what they set — not shown anywhere a student can see it. */
function answerSummary(q: Question): string {
  switch (q.type) {
    case "choice":
      return `Correct: ${q.options[q.answerIndex] ?? "—"}`;
    case "multi":
      return `Correct: ${q.answerIndexes.map((i) => q.options[i]).filter(Boolean).join(", ") || "—"}`;
    case "boolean":
      return `Correct: ${q.answer ? "Richtig / True" : "Falsch / False"}`;
    case "short":
      return `Accepted: ${q.accepted.filter(Boolean).join(", ") || "—"}`;
    case "paragraph":
      return q.guidance ? `Your note: ${q.guidance}` : "Marked by hand — no note left";
    default:
      return "";
  }
}

function AssignmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submissionId = searchParams.get("submission");

  const [tab, setTab] = useState<"mark" | "manage">(submissionId ? "mark" : "mark");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [scopeRequired, setScopeRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("A1");
  /** "" = every sitting at this level. See the note in the create route. */
  const [sessionSlot, setSessionSlot] = useState("");
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
      const options: ScopeOption[] = data.scopeOptions ?? [];
      setScopeOptions(options);
      setScopeRequired(Boolean(data.scopeRequired));
      setSelectedScopeKey((current) =>
        options.some((option) => option.key === current) ? current : options.length === 1 ? options[0].key : "",
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function clearNotificationFilter() {
    router.replace("/lecturer/assignments");
  }

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/lecturer/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          level: selectedScope?.level ?? level,
          branchId: selectedScope?.branchId ?? null,
          sessionSlot: selectedScope?.sessionSlot ?? sessionSlot,
          batch: selectedScope?.batch ?? null,
          type,
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

  const totalAwaiting = assignments.reduce((sum, a) => sum + (a.awaitingMarking ?? 0), 0);
  const selectedScope = scopeOptions.find((option) => option.key === selectedScopeKey) ?? null;

  return (
    <LecturerShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Assignments</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Mark what your students handed in, or set something new.
          </p>
        </div>

        {/* Two clearly separate jobs instead of one long scroll — marking is
            urgent and happens often; setting new work is occasional. */}
        <div className="mb-6 flex gap-2 border-b border-[var(--border)]">
          <button
            onClick={() => setTab("mark")}
            className={`relative px-4 py-2.5 text-sm font-semibold transition ${
              tab === "mark" ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--muted)]"
            }`}
          >
            To mark
            {totalAwaiting > 0 && (
              <span className="ml-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-white">
                {totalAwaiting}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("manage")}
            className={`px-4 py-2.5 text-sm font-semibold transition ${
              tab === "manage" ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--muted)]"
            }`}
          >
            My assignments
          </button>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {tab === "mark" && (
          <MarkingQueue
            submissionId={submissionId ?? undefined}
            onShowAll={submissionId ? clearNotificationFilter : undefined}
          />
        )}

        {tab === "manage" && (
          <>
            <div className="mb-6 flex justify-end">
              <button
                onClick={() => setOpen((v) => !v)}
                className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {open ? "Cancel" : "New assignment"}
              </button>
            </div>

            {open && (
              <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="text-xs font-medium text-[var(--foreground-soft)]">Title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="text-xs font-medium text-[var(--foreground-soft)]">Instructions</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                  </label>
                  {scopeRequired ? (
                    <label className="sm:col-span-2">
                      <span className="text-xs font-medium text-[var(--foreground-soft)]">Assigned class</span>
                      <select
                        value={selectedScopeKey}
                        onChange={(event) => {
                          setSelectedScopeKey(event.target.value);
                          setStudentIds([]);
                        }}
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      >
                        <option value="">Choose one of your assigned classes</option>
                        {scopeOptions.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                      {scopeOptions.length === 0 ? (
                        <p className="mt-1 text-xs text-amber-700">No class is assigned to this tutor account. Ask the office to check your teaching assignment.</p>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Homework is limited to this class. Online classes also reach hybrid students with the matching online sitting.
                        </p>
                      )}
                    </label>
                  ) : (
                    <>
                      <label>
                        <span className="text-xs font-medium text-[var(--foreground-soft)]">Level</span>
                        <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <label>
                        <span className="text-xs font-medium text-[var(--foreground-soft)]">Class time</span>
                        <select
                          value={sessionSlot}
                          onChange={(e) => setSessionSlot(e.target.value)}
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                        >
                          <option value="">Every sitting at this level</option>
                          <option value="morning">Morning only</option>
                          <option value="afternoon">Afternoon only</option>
                          <option value="evening">Evening only</option>
                          <option value="weekend">Weekend only</option>
                        </select>
                      </label>
                    </>
                  )}
                  <label>
                    <span className="text-xs font-medium text-[var(--foreground-soft)]">Type</span>
                    <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                      <option value="document">Document to hand in</option>
                      <option value="quiz">Timed quiz</option>
                    </select>
                  </label>

                  {type === "quiz" && (
                    <label>
                      <span className="text-xs font-medium text-[var(--foreground-soft)]">Time limit (minutes)</span>
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
                  {(!scopeRequired || selectedScope) && (
                    <StudentPicker
                      level={selectedScope?.level ?? level}
                      branchId={selectedScope?.branchId ?? null}
                      sessionSlot={(selectedScope?.sessionSlot ?? sessionSlot) || null}
                      batch={selectedScope?.batch ?? null}
                      selected={studentIds}
                      onChange={setStudentIds}
                    />
                  )}
                </div>

                <button
                  onClick={create}
                  disabled={saving || !title.trim() || (scopeRequired && !selectedScope)}
                  className="mt-6 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? "Creating…" : "Create assignment"}
                </button>
              </div>
            )}

            {loading ? (
              <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
            ) : assignments.length === 0 ? (
              <div className="py-12 text-center text-[var(--muted)]">No assignments set yet.</div>
            ) : (
              <div className="space-y-3">
                {assignments.map((a) => {
                  const isOpen = expanded === a.id;
                  return (
                    <div key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                      <button
                        onClick={() => setExpanded(isOpen ? null : a.id)}
                        className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${a.type === "quiz" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                              {a.type}
                            </span>
                            <span className="rounded bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-bold">{a.level}</span>
                            {a.timeLimitMinutes && <span className="text-xs text-amber-700">⏱ {a.timeLimitMinutes} min</span>}
                            {a.awaitingMarking > 0 && (
                              <span className="rounded bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-white">
                                {a.awaitingMarking} to mark
                              </span>
                            )}
                          </div>
                          <h3 className="mt-1.5 font-semibold">{a.title}</h3>
                        </div>
                        <p className="text-sm text-[var(--muted)]">
                          {a.submissions.length} submitted · {isOpen ? "Hide" : "View"}
                        </p>
                      </button>

                      {isOpen && (
                        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                          {a.description && (
                            <p className="whitespace-pre-wrap text-sm text-[var(--foreground-soft)]">{a.description}</p>
                          )}

                          {/* The thing tutors were losing — once a quiz was set and
                              students had it, there was no way back to see what the
                              questions and correct answers even were. */}
                          {a.type === "quiz" && Array.isArray(a.questions) && a.questions.length > 0 && (
                            <div className="space-y-2">
                              {a.questions.map((q, i) => (
                                <div key={i} className="rounded-lg bg-[var(--surface-alt)] p-3 text-sm">
                                  <p className="font-medium">
                                    {i + 1}. {q.prompt}
                                    <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
                                      {QUESTION_TYPE_LABELS[q.type]} · {q.points} mark{q.points === 1 ? "" : "s"}
                                    </span>
                                  </p>
                                  <p className="mt-1 text-xs text-[var(--muted)]">{answerSummary(q)}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {a.submissions.length > 0 && (
                            <div className="space-y-1 pt-1">
                              {a.submissions.slice(0, 5).map((s) => (
                                <div key={s.id} className="flex items-center justify-between text-sm">
                                  <span>
                                    {s.student.user.name ?? "—"}
                                    {s.student.studentCode && (
                                      <span className="ml-2 font-mono text-xs text-[var(--muted)]">{s.student.studentCode}</span>
                                    )}
                                  </span>
                                  <span className="font-semibold">{s.score ?? "—"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </LecturerShell>
  );
}

export default function LecturerAssignmentsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--muted)]">Loading…</div>}>
      <AssignmentsContent />
    </Suspense>
  );
}
