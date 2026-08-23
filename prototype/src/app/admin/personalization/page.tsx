"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import AdminShell from "@/components/AdminShell";
import { AlertIcon, CompassIcon } from "@/components/icons";

/**
 * STUDY PLAN HEALTH.
 *
 * This page was called "Personalization analytics" and opened with a tile
 * reading "Planner strategies: 3 — deterministic, fewshot, hybrid". That is
 * the name of three code paths inside the planner. It was on a screen built
 * for a school secretary, next to a tile counting rows in a cache table and
 * another one restating the reader's own job title back at them.
 *
 * The rewrite kept every underlying query and threw away the framing. What is
 * left answers three questions in the order somebody actually has them:
 *
 *   1. CAN I TRUST WHAT IS ON THIS PAGE? Coverage first, and if the answer is
 *      no the page says so in a sentence and refuses to draw a school average
 *      out of nine students.
 *   2. WHAT IS THIS SCHOOL WORST AT? One skill, named, with the number.
 *   3. WHO NEEDS HELP, AND WITH WHAT? Named students, one row each, linking
 *      into their file.
 *
 * Behaviour — when people study and who is drifting away — lives next door on
 * /admin/intelligence. This page is only about what they are getting WRONG.
 */

type Health = {
  generatedAt: string;
  coverage: {
    activeStudents: number;
    assessed: number;
    trustworthy: boolean;
    cachedPlans: number;
    lastPlanAt: string | null;
  };
  weakestSkill: { skill: string; average: number; learners: number } | null;
  strongestSkill: { skill: string; average: number; learners: number } | null;
  skills: Array<{ skill: string; average: number; learners: number }>;
  needHelp: Array<{
    studentId: string;
    name: string;
    level: string;
    weakest: number;
    skills: Array<{ skill: string; mastery: number; attempts: number }>;
  }>;
};

function bar(value: number) {
  if (value >= 70) return "bg-emerald-500";
  if (value >= 50) return "bg-amber-500";
  return "bg-red-500";
}

export default function StudyPlanHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/personalization", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load study plan health");
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load study plan health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const coverageShare =
    data && data.coverage.activeStudents > 0
      ? Math.round((data.coverage.assessed / data.coverage.activeStudents) * 100)
      : 0;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Intelligence</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Study plan health</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Every student has a running score in each language skill, built up from the exercises and exams they
              have actually done. The portal uses those scores to decide what to put in front of them next. This page
              shows whether that is working — what the school is weakest at, and who is struggling.
            </p>
          </div>
          <Link
            href="/admin/intelligence"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)]"
          >
            <CompassIcon className="h-4 w-4" />
            Learner patterns
          </Link>
        </div>

        {error && (
          <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => void load()} className="ml-3 font-bold underline">
              Retry
            </button>
          </div>
        )}

        {loading && !data && (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            Loading…
          </div>
        )}

        {data && (
          <>
            {/* ---- Can this page be trusted --------------------------- */}
            <div
              className={`flex flex-wrap items-start gap-3 rounded-3xl border p-5 ${
                data.coverage.trustworthy
                  ? "border-[var(--border)] bg-[var(--surface-alt)]"
                  : "border-amber-400/50 bg-amber-500/10"
              }`}
            >
              <span className={`mt-0.5 ${data.coverage.trustworthy ? "text-[var(--muted)]" : "text-amber-600"}`}>
                <AlertIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold">
                  {data.coverage.assessed} of {data.coverage.activeStudents} active students have been scored on at
                  least one skill ({coverageShare}%)
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {data.coverage.trustworthy
                    ? "That is enough of the roster for the averages below to mean something."
                    : "That is too little of the roster to draw a school average from. Treat the figures below as a look at those particular students, not as a picture of the school. Scores accumulate as students do exercises and sit exams."}
                </p>
              </div>
            </div>

            {/* ---- The headline ---------------------------------------- */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  The school&apos;s weakest skill
                </p>
                {data.weakestSkill ? (
                  <>
                    <p className="mt-2 text-3xl font-black capitalize">{data.weakestSkill.skill}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Averaging {data.weakestSkill.average}% across {data.weakestSkill.learners} scored learners. This
                      is the one to put extra class time into.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">Nothing has been scored yet.</p>
                )}
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Strongest</p>
                {data.strongestSkill ? (
                  <>
                    <p className="mt-2 text-3xl font-black capitalize">{data.strongestSkill.skill}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Averaging {data.strongestSkill.average}% across {data.strongestSkill.learners} scored learners.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">Nothing has been scored yet.</p>
                )}
              </div>
            </div>

            {/* ---- Every skill ----------------------------------------- */}
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-lg font-bold">Every skill, worst first</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Green is 70% and up, amber is a pass, red needs teaching time.
              </p>
              <div className="mt-5 space-y-4">
                {data.skills.map((row) => (
                  <div key={row.skill}>
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold capitalize">{row.skill}</span>
                      <span className="text-[var(--muted)]">
                        {row.average}% · {row.learners} learner{row.learners === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 rounded-full bg-[var(--border)]">
                      <div
                        className={`h-2.5 rounded-full ${bar(row.average)}`}
                        style={{ width: `${Math.max(1, Math.min(100, row.average))}%` }}
                      />
                    </div>
                  </div>
                ))}
                {data.skills.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">
                    No skill has been scored yet. Scores appear once students start completing exercises and exams.
                  </p>
                )}
              </div>
            </section>

            {/* ---- Who needs help -------------------------------------- */}
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-lg font-bold">Students who need help</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Anyone scoring under 50% in a skill, weakest first. One row per student — a learner struggling with
                four things appears once, with all four.
              </p>
              {data.needHelp.length === 0 ? (
                <p className="mt-5 text-sm text-[var(--muted)]">Nobody is currently under 50% in any scored skill.</p>
              ) : (
                <ul className="mt-5 divide-y divide-[var(--border)]">
                  {data.needHelp.map((row) => (
                    <li key={row.studentId} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black ${
                          row.weakest < 30 ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"
                        }`}
                        title="Lowest skill score"
                      >
                        {row.weakest}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {row.name}
                          <span className="ml-2 text-xs font-normal text-[var(--muted)]">{row.level}</span>
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {row.skills
                            .map((skill) => `${skill.skill} ${skill.mastery}%`)
                            .join(" · ")}
                        </p>
                      </div>
                      <Link
                        href={`/admin/students/${row.studentId}`}
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        Open file
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="text-xs text-[var(--muted)]">
              {data.coverage.cachedPlans} study plan{data.coverage.cachedPlans === 1 ? " has" : "s have"} been
              generated
              {data.coverage.lastPlanAt
                ? `, most recently ${new Date(data.coverage.lastPlanAt).toLocaleString("en-GB")}`
                : ""}
              . Read {new Date(data.generatedAt).toLocaleString("en-GB")}.
            </p>
          </>
        )}
      </div>
    </AdminShell>
  );
}
