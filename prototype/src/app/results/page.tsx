"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import StudentShell from "@/components/StudentShell";
import { AttendanceIcon, EmptyIcon, SparklesIcon, TrendingUpIcon } from "@/components/icons";

/**
 * A student's results.
 *
 * WHAT CHANGED. It used to be a list of scores with an average on top, which
 * answers "what did I get" and nothing else. A student looking at their marks
 * is really asking three questions — how am I doing, what am I bad at, and am
 * I getting better — and only the first was on the page.
 *
 * So the page now leads with the skill breakdown (what to work on), carries a
 * trend line (which way it is going) and a class band (whether that is good),
 * and keeps the per-exam detail underneath for anyone who wants the receipts.
 *
 * THE BAND IS NOT A RANK, and that is a product decision, not a shortcut. The
 * server never sends a position and this page could not display "9th of 24" if
 * it wanted to. See the comment in /api/student/results.
 */

type Skill = {
  type: string;
  average: number;
  grade: string;
  latest: number;
  latestAt: string;
  attempts: number;
  change: number | null;
  passed: boolean;
  feedback: string | null;
};

type ExamResult = {
  id: string;
  examName: string;
  examDate: string;
  score: number;
  total: number;
  grade: string;
  passed: boolean;
  feedback: string | null;
  submissionMode: string;
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
  submissionMode: string;
  createdAt: string;
};

type Payload = {
  level: string;
  overall: number | null;
  overallGrade: string | null;
  passMark: number;
  totalResults: number;
  examsPassed: number;
  examsTaken: number;
  skills: Skill[];
  strongest: Skill | null;
  weakest: Skill | null;
  timeline: Array<{ at: string; score: number; label: string; isExam: boolean }>;
  standing: { band: string; classSize: number; classAverage: number } | null;
  attendance: { held: number; present: number; percent: number } | null;
  courses: CourseResults[];
  coursework: Coursework[];
};

const TYPE_LABELS: Record<string, string> = {
  essay: "Essay",
  quiz: "Quiz",
  speaking: "Speaking",
  pronunciation: "Pronunciation",
  exam: "Exam",
  classwork: "Classwork",
  writing: "Writing",
  listening: "Listening",
  "mock exam": "Mock exam",
};

function label(type: string) {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function gradeTone(grade: string) {
  if (grade === "A" || grade === "B") return "bg-[var(--success-soft)] text-[var(--success)]";
  if (grade === "C") return "bg-amber-500/15 text-amber-700";
  if (grade === "D") return "bg-orange-100 text-orange-700";
  return "bg-rose-500/15 text-red-700";
}

function barTone(score: number, passMark: number) {
  if (score >= 85) return "bg-emerald-500";
  if (score >= passMark) return "bg-sky-500";
  if (score >= passMark - 10) return "bg-amber-500";
  return "bg-rose-500";
}

/* ------------------------------------------------------------------ pieces */

function ScoreBar({ score, passMark }: { score: number; passMark: number }) {
  const passed = score >= passMark;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
      <div
        className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-red-400"}`}
        style={{ width: `${Math.min(100, score)}%` }}
      />
      {/* The pass mark, so a score reads as pass or fail at a glance. */}
      <div
        className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
        style={{ left: `${passMark}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * The trend line.
 *
 * An SVG that stretches to whatever width it is given — no fixed pixel widths,
 * because this sits in a card that is 320px wide on a phone and 700 on a
 * laptop. `preserveAspectRatio="none"` plus `vectorEffect` keeps the stroke a
 * constant weight while the shape stretches.
 */
function TrendChart({
  points,
  passMark,
}: {
  points: Array<{ at: string; score: number; label: string }>;
  passMark: number;
}) {
  const shape = useMemo(() => {
    if (points.length < 2) return null;
    const step = 100 / (points.length - 1);
    const y = (score: number) => 100 - score;
    const line = points
      .map((point, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${y(point.score).toFixed(2)}`)
      .join(" ");
    return {
      line,
      area: `${line} L 100 100 L 0 100 Z`,
      dots: points.map((point, i) => ({ x: i * step, y: y(point.score), score: point.score })),
    };
  }, [points]);

  if (!shape) {
    return (
      <p className="text-sm text-[var(--muted)]">
        One more mark and your progress line appears here.
      </p>
    );
  }

  const first = points[0].score;
  const last = points[points.length - 1].score;
  const move = last - first;

  return (
    <div>
      <div className="relative h-28 w-full sm:h-36">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* The pass mark as a rule across the chart — a line going up is only
              good news if you can see whether it is above the bar. */}
          <line
            x1="0"
            y1={100 - passMark}
            x2="100"
            y2={100 - passMark}
            stroke="var(--muted)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            opacity="0.6"
          />

          <path d={shape.area} fill="url(#trend-fill)" />
          <path
            d={shape.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {shape.dots.map((dot, i) => (
            <circle
              key={i}
              cx={dot.x}
              cy={dot.y}
              r="3"
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        <span>{new Date(points[0].at).toLocaleDateString()}</span>
        <span className={`font-bold ${move >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {move >= 0 ? "▲" : "▼"} {Math.abs(move)} points since you started
        </span>
        <span>{new Date(points[points.length - 1].at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

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
      {/* min-w-0 so a long exam name can never widen the page past the screen. */}
      <div className="min-w-0 px-3 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)] sm:text-sm sm:tracking-[0.24em]">
              Your progress
            </p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Grades and results</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Every score from your classes and exams, and what they say about where to put your time.
            </p>
          </div>
          {data && data.totalResults > 0 ? (
            <a
              href="/results/sheet"
              className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
            >
              Download result sheet
            </a>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-3xl bg-[var(--surface-alt)]" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>
        ) : !data || data.totalResults === 0 ? (
          <div className="rounded-3xl cinematic-card p-8 text-center sm:p-10">
            <EmptyIcon className="mx-auto h-10 w-10 text-[var(--muted)]" />
            <p className="mt-3 text-sm font-semibold">No results yet</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Your scores will appear here once your tutor releases them.
            </p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* ---- Headline figures ------------------------------------ */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="min-w-0 rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <p className="truncate text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:text-xs sm:tracking-[0.24em]">
                  Overall
                </p>
                <div className="mt-2 flex items-baseline gap-2 sm:mt-3">
                  <span className="text-3xl font-bold sm:text-4xl">{data.overall ?? "—"}</span>
                  {data.overallGrade && (
                    <span className={`rounded px-2 py-0.5 text-sm font-semibold ${gradeTone(data.overallGrade)}`}>
                      {data.overallGrade}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">
                  weighted across your skills · {data.totalResults} recorded score
                  {data.totalResults === 1 ? "" : "s"}
                </p>
              </div>

              <div className="min-w-0 rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <p className="truncate text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:text-xs sm:tracking-[0.24em]">
                  Exams passed
                </p>
                <p className="mt-2 text-3xl font-bold sm:mt-3 sm:text-4xl">
                  {data.examsPassed}
                  <span className="text-lg font-medium text-[var(--muted)] sm:text-xl"> / {data.examsTaken}</span>
                </p>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">Pass mark is {data.passMark}</p>
              </div>

              <div className="min-w-0 rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <p className="truncate text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:text-xs sm:tracking-[0.24em]">
                  Attendance
                </p>
                <p className="mt-2 text-3xl font-bold sm:mt-3 sm:text-4xl">
                  {data.attendance ? `${data.attendance.percent}%` : "—"}
                </p>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">
                  {data.attendance
                    ? `${data.attendance.present} of ${data.attendance.held} classes`
                    : "No register yet"}
                </p>
              </div>

              <div className="min-w-0 rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <p className="truncate text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:text-xs sm:tracking-[0.24em]">
                  In your class
                </p>
                <p className="mt-2 text-xl font-bold capitalize sm:mt-3 sm:text-2xl">
                  {data.standing?.band ?? "—"}
                </p>
                <p className="mt-2 truncate text-xs text-[var(--muted)]">
                  {data.standing
                    ? `class average ${data.standing.classAverage}`
                    : "Needs a few more classmates marked"}
                </p>
              </div>
            </div>

            {/* ---- What to work on -------------------------------------
                The single most useful sentence on the page, so it gets to be
                a headline rather than a caption under a chart. */}
            {data.weakest && data.strongest && (
              <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4 sm:rounded-3xl sm:p-5">
                <p className="flex items-center gap-2 text-sm font-bold text-[var(--accent-ink)]">
                  <SparklesIcon className="h-4 w-4 shrink-0" />
                  Where to put your time
                </p>
                <p className="mt-1.5 text-sm leading-6 text-[var(--foreground-soft)]">
                  Your <strong>{label(data.strongest.type).toLowerCase()}</strong> is your strongest
                  at {data.strongest.average}. Your{" "}
                  <strong>{label(data.weakest.type).toLowerCase()}</strong> is{" "}
                  {data.weakest.average}
                  {data.weakest.average < data.passMark
                    ? " — below the pass mark, so it is the one holding your average down."
                    : ", which is the biggest gain available to you right now."}
                </p>
              </div>
            )}

            {/* ---- Skills ---------------------------------------------- */}
            {data.skills.length > 0 && (
              <section className="rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <h2 className="text-base font-semibold sm:text-lg">Your skills</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Each one averaged across every time it has been marked.
                </p>

                <div className="mt-4 space-y-3.5">
                  {data.skills.map((skill) => (
                    <div key={skill.type} className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="truncate text-sm font-semibold">{label(skill.type)}</span>
                        <span className="flex shrink-0 items-center gap-2 text-sm">
                          {skill.change !== null && skill.change !== 0 && (
                            <span
                              className={`text-xs font-bold ${
                                skill.change > 0 ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {skill.change > 0 ? "▲" : "▼"} {Math.abs(skill.change)}
                            </span>
                          )}
                          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${gradeTone(skill.grade)}`}>
                            {skill.grade}
                          </span>
                          <span className="font-bold tabular-nums">{skill.average}</span>
                        </span>
                      </div>

                      <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                        <div
                          className={`h-full rounded-full ${barTone(skill.average, data.passMark)}`}
                          style={{ width: `${Math.min(100, skill.average)}%` }}
                        />
                        <div
                          className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
                          style={{ left: `${data.passMark}%` }}
                          aria-hidden
                        />
                      </div>

                      <p className="mt-1 truncate text-xs text-[var(--muted)]">
                        {skill.attempts} mark{skill.attempts === 1 ? "" : "s"}
                        {skill.feedback ? ` · ${skill.feedback}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---- Trend ----------------------------------------------- */}
            <section className="rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                <TrendingUpIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                How you are moving
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Every mark in the order you earned it. The dashed line is the pass mark.
              </p>
              <div className="mt-4">
                <TrendChart points={data.timeline} passMark={data.passMark} />
              </div>
            </section>

            {/* ---- Per-course exam detail ------------------------------ */}
            {data.courses.map((course) => (
              <section
                key={course.courseId}
                className="rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold sm:text-lg">{course.courseTitle}</h2>
                    {course.level && <p className="text-xs text-[var(--muted)]">Level {course.level}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Average</p>
                    <p className="text-xl font-bold sm:text-2xl">{course.average}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3 sm:mt-5 sm:space-y-4">
                  {course.results.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3.5 sm:rounded-2xl sm:p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{r.examName}</p>
                          <p className="truncate text-xs text-[var(--muted)]">
                            {new Date(r.examDate).toLocaleDateString()}
                            {r.submissionMode === "physical" && " · sat on paper"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${gradeTone(r.grade)}`}>
                            {r.grade}
                          </span>
                          <span className="text-sm font-bold tabular-nums">
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
              </section>
            ))}

            {/* ---- Everything not tied to an exam ---------------------- */}
            {data.coursework.length > 0 && (
              <section className="rounded-2xl cinematic-card p-4 sm:rounded-3xl sm:p-6">
                <h2 className="text-base font-semibold sm:text-lg">Every mark, one by one</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Classwork and practice, which sit outside your exam averages.
                </p>
                <div className="mt-4 space-y-2.5">
                  {data.coursework.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3.5 sm:rounded-2xl sm:p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{label(c.type)}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </p>
                        {c.feedback && (
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{c.feedback}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${gradeTone(c.grade)}`}>
                          {c.grade}
                        </span>
                        <span className="text-sm font-bold tabular-nums">{c.score}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* No invented statistic here. The school has no measured link
                between attendance and grades to quote, and a made-up one on a
                student's own results page would be the worst place to start. */}
            {data.attendance && data.attendance.percent < 75 && (
              <p className="flex items-center justify-center gap-2 pb-2 text-center text-xs text-[var(--muted)]">
                <AttendanceIcon className="h-3.5 w-3.5 shrink-0" />
                You have missed {data.attendance.held - data.attendance.present} of{" "}
                {data.attendance.held} classes. Speak to your tutor about catching up.
              </p>
            )}
          </div>
        )}
      </div>
    </StudentShell>
  );
}
