"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";

type ExamResult = {
  id: string;
  examName: string;
  examDate: string;
  score: number;
  total: number;
  grade: string;
  passed: boolean;
  feedback: string | null;
};

type CourseResults = {
  courseId: string;
  courseTitle: string;
  level: string | null;
  results: ExamResult[];
  average: number;
};

type Coursework = {
  id: string;
  type: string;
  score: number;
  grade: string;
  feedback: string | null;
  createdAt: string;
};

type Payload = {
  overall: number | null;
  overallGrade: string | null;
  passMark: number;
  totalResults: number;
  examsPassed: number;
  examsTaken: number;
  courses: CourseResults[];
  coursework: Coursework[];
};

const TYPE_LABELS: Record<string, string> = {
  essay: "Essay",
  quiz: "Quiz",
  speaking: "Speaking",
  pronunciation: "Pronunciation",
  exam: "Exam",
};

function gradeTone(grade: string) {
  if (grade === "A" || grade === "B") return "bg-emerald-100 text-emerald-700";
  if (grade === "C") return "bg-amber-100 text-amber-700";
  if (grade === "D") return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function ScoreBar({ score, passMark }: { score: number; passMark: number }) {
  const passed = score >= passMark;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-red-400"}`}
        style={{ width: `${Math.min(100, score)}%` }}
      />
      {/* The pass mark, so a score reads as pass or fail at a glance. */}
      <div
        className="absolute inset-y-0 w-px bg-slate-500/70"
        style={{ left: `${passMark}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

export default function ResultsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/student/results", { cache: "no-store" });
        if (!res.ok) throw new Error("Unable to load your results");
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <StudentShell>
      <div className="px-6 py-8">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            Your progress
          </p>
          <h1 className="mt-2 text-3xl font-bold">Grades and results</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Every score from your exams and coursework, in one place.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-3xl bg-slate-200/60" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !data || data.totalResults === 0 ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <div className="text-4xl">📋</div>
            <p className="mt-3 text-sm font-semibold">No results yet</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Your scores will appear here once your tutor releases them.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Overall average</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{data.overall ?? "—"}</span>
                  {data.overallGrade && (
                    <span className={`rounded px-2 py-0.5 text-sm font-semibold ${gradeTone(data.overallGrade)}`}>
                      {data.overallGrade}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">Across {data.totalResults} recorded scores</p>
              </div>

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Exams passed</p>
                <p className="mt-3 text-4xl font-bold">
                  {data.examsPassed}
                  <span className="text-xl font-medium text-[var(--muted)]"> / {data.examsTaken}</span>
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">Pass mark is {data.passMark}</p>
              </div>

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Coursework</p>
                <p className="mt-3 text-4xl font-bold">{data.coursework.length}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">Essays, quizzes and practice</p>
              </div>
            </div>

            {data.courses.map((course) => (
              <div key={course.courseId} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{course.courseTitle}</h2>
                    {course.level && (
                      <p className="text-xs text-[var(--muted)]">Level {course.level}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Average</p>
                    <p className="text-2xl font-bold">{course.average}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {course.results.map((r) => (
                    <div key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{r.examName}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {new Date(r.examDate).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${gradeTone(r.grade)}`}>
                            {r.grade}
                          </span>
                          <span className="text-sm font-bold">
                            {r.score}
                            <span className="font-normal text-[var(--muted)]">/{r.total}</span>
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <ScoreBar score={r.score} passMark={data.passMark} />
                      </div>

                      {r.feedback && (
                        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{r.feedback}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {data.coursework.length > 0 && (
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="text-lg font-semibold">Coursework and practice</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Not tied to a formal exam, so these sit outside your course averages.
                </p>
                <div className="mt-4 space-y-3">
                  {data.coursework.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{TYPE_LABELS[c.type] ?? c.type}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </p>
                        {c.feedback && (
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{c.feedback}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${gradeTone(c.grade)}`}>
                          {c.grade}
                        </span>
                        <span className="text-sm font-bold">{c.score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </StudentShell>
  );
}
