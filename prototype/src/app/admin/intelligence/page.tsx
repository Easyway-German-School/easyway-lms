"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import AdminShell from "@/components/AdminShell";
import { AlertIcon, CompassIcon, EyeIcon, RefreshIcon, TrendingUpIcon } from "@/components/icons";

/**
 * LEARNER PATTERNS — what the school's students actually do.
 *
 * THE PAGE THIS REPLACES A GAP LEFT BY. "Personalization analytics" printed
 * three counters and two bar charts and told nobody anything: it could say how
 * many plans were cached, which is a fact about our database, and not one
 * thing about a student. The school's real questions are "who is about to
 * drop out", "when should we actually send this", "is this level one group or
 * six people", and none of them were answerable from any screen.
 *
 * HOW IT IS ORGANISED, and why in this order:
 *
 *   1. FINDINGS FIRST, in sentences. A chart is homework; a finding is the
 *      chart already read. The front desk should be able to open this page,
 *      read four lines and know what to do, without being taught what an
 *      entropy is.
 *   2. THE PEOPLE TO RING. Names, one line of evidence each, and a link
 *      straight into their file. An insight you cannot act on by lunchtime is
 *      a decoration.
 *   3. THE SCHOOL'S CLOCK. When learning actually happens, on the students'
 *      own clocks. This is the single most immediately useful thing here —
 *      every broadcast, deadline and revision session is currently timed by
 *      guesswork.
 *   4. GROUPS, then the archetypes behind them.
 *
 * EVERY NUMBER SAYS HOW MUCH EVIDENCE IS BEHIND IT. A "40% lift" among four
 * learners is noise, and a page that renders it identically to a real one is
 * worse than a page with no chart at all. Sample sizes travel with the rows,
 * and the whole page says plainly at the top how much of the roster it can
 * actually see.
 */

type Finding = { headline: string; detail: string; tone: "good" | "warn" | "bad" | "neutral" };

type Intelligence = {
  generatedAt: string;
  windowDays: number;
  coverage: { students: number; observed: number; optedOut: number; eventsInWindow: number };
  archetypes: Array<{ key: string; label: string; blurb: string; tone: string; count: number; share: number }>;
  hourHistogram: number[];
  weekdayHistogram: number[];
  surfaces: Array<{ area: string; seconds: number; learners: number; share: number }>;
  cohorts: Array<{
    group: string;
    learners: number;
    avgEngagement: number;
    avgRisk: number;
    atRisk: number;
    measured: number;
    peakHour: number | null;
    cohesion: number;
    archetypes: Array<{ key: string; label: string; count: number; share: number }>;
    distinctive: Array<{ area: string; lift: number; learners: number; groupShare: number; schoolShare: number }>;
  }>;
  atRisk: Array<{
    userId: string;
    studentId: string | null;
    name: string;
    level: string;
    riskScore: number;
    daysSinceSeen: number | null;
    archetype: string;
    summary: string;
  }>;
  standouts: Array<{ userId: string; studentId: string | null; name: string; level: string; engagementScore: number; currentStreak: number; archetype: string }>;
  findings: Finding[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourLabel(hour: number) {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function minutes(seconds: number) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} hrs`;
}

const TONE_CLASS: Record<string, string> = {
  good: "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-300",
  neutral: "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--foreground)]",
};

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function LearnerIntelligencePage() {
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (recompute = false) => {
    if (recompute) setRecomputing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/intelligence", {
        method: recompute ? "POST" : "GET",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not read learner behaviour");
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not read learner behaviour");
    } finally {
      setLoading(false);
      setRecomputing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clockMax = useMemo(() => Math.max(1, ...(data?.hourHistogram ?? [1])), [data]);
  const weekMax = useMemo(() => Math.max(1, ...(data?.weekdayHistogram ?? [1])), [data]);
  const surfaceMax = useMemo(() => Math.max(1, ...(data?.surfaces ?? []).map((row) => row.seconds)), [data]);

  /** How much of the roster we can actually see. Printed, never hidden. */
  const coverageShare = data && data.coverage.students > 0
    ? Math.round((data.coverage.observed / data.coverage.students) * 100)
    : 0;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
              <CompassIcon className="h-4 w-4" />
              Intelligence
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Learner patterns</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              What students actually do in the portal — when they study, what they use, who is drifting away —
              read over the last {data?.windowDays ?? 60} days. Everything here is derived from movement inside the
              app. Nothing anybody typed is recorded.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={recomputing || loading}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
          >
            <RefreshIcon className="h-4 w-4" />
            {recomputing ? "Recomputing…" : "Recompute now"}
          </button>
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
            Reading the school…
          </div>
        )}

        {data && (
          <>
            {/* ---- How much we can actually see -------------------------- */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Students we can see",
                  value: `${data.coverage.observed} of ${data.coverage.students}`,
                  sub: `${coverageShare}% of the roster has generated any activity at all`,
                },
                {
                  label: "Movements recorded",
                  value: data.coverage.eventsInWindow.toLocaleString(),
                  sub: `over ${data.windowDays} days`,
                },
                {
                  label: "Behaviour groups found",
                  value: String(data.archetypes.length),
                  sub: "distinct patterns of using the portal",
                },
                {
                  label: "Opted out",
                  value: String(data.coverage.optedOut),
                  sub: "students who asked not to be measured, and are not",
                },
              ].map((tile) => (
                <div key={tile.label} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{tile.label}</p>
                  <p className="mt-2 text-2xl font-black">{tile.value}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{tile.sub}</p>
                </div>
              ))}
            </div>

            {/* ---- Findings, in sentences -------------------------------- */}
            <Panel
              title="What the numbers say"
              hint="Read for you. Each line is a pattern big enough to be worth acting on."
            >
              {data.findings.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  Nothing stands out yet. That is a real answer, not an empty screen — no group is behaving
                  differently enough from the rest of the school to be worth a decision.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.findings.map((finding) => (
                    <li
                      key={finding.headline}
                      className={`rounded-2xl border p-4 ${TONE_CLASS[finding.tone] ?? TONE_CLASS.neutral}`}
                    >
                      <p className="font-bold">{finding.headline}</p>
                      <p className="mt-1 text-sm opacity-90">{finding.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* ---- The people to ring ------------------------------------ */}
            <Panel
              title="Worth a phone call"
              hint="Ranked by how strongly the pattern resembles somebody who is about to stop coming. This shows up weeks before an unpaid invoice does."
            >
              {data.atRisk.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nobody is showing the drop-out pattern. Good.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {data.atRisk.map((row) => (
                    <li key={row.userId} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black ${
                          row.riskScore >= 80 ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"
                        }`}
                        title="Risk score out of 100"
                      >
                        {row.riskScore}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {row.name}
                          <span className="ml-2 text-xs font-normal text-[var(--muted)]">{row.level}</span>
                        </p>
                        <p className="text-xs text-[var(--muted)]">{row.summary}</p>
                      </div>
                      {row.studentId && (
                        <Link
                          href={`/admin/students/${row.studentId}/remote`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--surface-alt)]"
                        >
                          <EyeIcon className="h-3.5 w-3.5" />
                          Remote view
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* ---- The school's clock ------------------------------------ */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <Panel
                  title="When the school actually studies"
                  hint="On the students' own clocks, not the server's. The tallest bar is the hour to aim a broadcast, a deadline or a revision session at."
                >
                  <div className="flex h-40 items-end gap-1">
                    {data.hourHistogram.map((value, hour) => (
                      <div key={hour} className="group flex flex-1 flex-col items-center justify-end gap-1">
                        <span className="text-[9px] font-bold text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                          {minutes(value)}
                        </span>
                        <div
                          className="w-full rounded-t bg-[var(--accent)] transition group-hover:brightness-110"
                          style={{ height: `${Math.max(2, (value / clockMax) * 100)}%` }}
                          title={`${hourLabel(hour)} · ${minutes(value)}`}
                        />
                        {hour % 3 === 0 && (
                          <span className="text-[9px] text-[var(--muted)]">{hourLabel(hour).replace(":00", "")}</span>
                        )}
                        {hour % 3 !== 0 && <span className="text-[9px] text-transparent">.</span>}
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <Panel title="Which days" hint="Total attention per weekday.">
                <div className="space-y-2">
                  {data.weekdayHistogram.map((value, index) => (
                    <div key={index}>
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold">{WEEKDAYS[index]}</span>
                        <span className="text-[var(--muted)]">{minutes(value)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[var(--border)]">
                        <div
                          className="h-2 rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.max(1, (value / weekMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* ---- Behaviour groups -------------------------------------- */}
            <Panel
              title="The kinds of learner in this school"
              hint="Every student falls into exactly one. The label is a description of a habit, not a judgement of ability."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.archetypes.map((row) => (
                  <div
                    key={row.key}
                    className={`rounded-2xl border p-4 ${TONE_CLASS[row.tone] ?? TONE_CLASS.neutral}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-bold">{row.label}</p>
                      <p className="text-sm font-black">
                        {row.count}
                        <span className="ml-1 text-xs font-normal opacity-70">{Math.round(row.share * 100)}%</span>
                      </p>
                    </div>
                    <p className="mt-1 text-xs opacity-85">{row.blurb}</p>
                  </div>
                ))}
              </div>
            </Panel>

            {/* ---- Cohorts ----------------------------------------------- */}
            <Panel
              title="Levels, read as groups"
              hint="Cohesion says whether a level behaves like one group or like a list of unrelated people. Levels under five students are left out — three people and a rounding error is not a pattern."
            >
              {data.cohorts.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No level has five or more students with recorded activity yet.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {data.cohorts.map((cohort) => (
                    <div key={cohort.group} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-lg font-black">{cohort.group}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {cohort.learners} learners ·{" "}
                          {cohort.measured < 5
                            ? `${cohort.measured} with a readable habit`
                            : `${cohort.atRisk} at risk`}
                        </p>
                      </div>
                      <p className="mt-2 text-sm">
                        {/*
                          An unread level is not a cohesive one. Saying "behaves
                          as one group" about people we have never observed is
                          the single easiest way for this page to talk somebody
                          into a decision it has no evidence for.
                        */}
                        {cohort.measured < 5
                          ? `Only ${cohort.measured} of these ${cohort.learners} have used the portal enough to read. There is no group pattern here yet — that is a gap in what we have seen, not a finding about them.`
                          : cohort.cohesion >= 0.5
                            ? "Behaves as one group — a blanket announcement will suit most of them."
                            : cohort.cohesion >= 0.3
                              ? "Loosely alike. Some targeting pays off."
                              : "Not really one group. Anything sent to all of them will fail most of them."}
                        {cohort.measured >= 5 && cohort.peakHour !== null && ` Busiest around ${hourLabel(cohort.peakHour)}.`}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {cohort.archetypes.slice(0, 4).map((row) => (
                          <span
                            key={row.key}
                            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold"
                          >
                            {row.label} · {row.count}
                          </span>
                        ))}
                      </div>
                      {cohort.distinctive.length > 0 && (
                        <div className="mt-4 border-t border-[var(--border)] pt-3">
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                            What sets them apart
                          </p>
                          <ul className="mt-2 space-y-1.5 text-xs">
                            {cohort.distinctive.map((row) => (
                              <li key={row.area} className="flex items-center justify-between gap-2">
                                <span className="truncate">{row.area}</span>
                                <span
                                  className={`shrink-0 font-bold ${row.lift >= 1 ? "text-emerald-600" : "text-amber-600"}`}
                                  title={`${row.learners} learners in this level use it`}
                                >
                                  {row.lift >= 1
                                    ? `${Math.round((row.lift - 1) * 100)}% more`
                                    : `${Math.round((1 - row.lift) * 100)}% less`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* ---- Surfaces and standouts -------------------------------- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Where the attention goes" hint="Total time on each part of the portal, and how many students it reaches.">
                <div className="space-y-3">
                  {data.surfaces.slice(0, 12).map((row) => (
                    <div key={row.area}>
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold capitalize">{row.area}</span>
                        <span className="text-[var(--muted)]">
                          {minutes(row.seconds)} · {row.learners} learners
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[var(--border)]">
                        <div
                          className="h-2 rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.max(1, (row.seconds / surfaceMax) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {data.surfaces.length === 0 && (
                    <p className="text-sm text-[var(--muted)]">No movement recorded yet.</p>
                  )}
                </div>
              </Panel>

              <Panel title="Doing best" hint="Highest sustained engagement. Worth naming in class, and worth asking what is working for them.">
                {data.standouts.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">Not enough activity yet to pick anybody out.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {data.standouts.map((row) => (
                      <li key={row.userId} className="flex items-center gap-3 py-2.5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-sm font-black text-emerald-600">
                          {row.engagementScore}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{row.name}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {row.level}
                            {row.currentStreak > 1 ? ` · ${row.currentStreak}-day streak` : ""}
                          </p>
                        </div>
                        {row.studentId && (
                          <Link
                            href={`/admin/students/${row.studentId}`}
                            className="text-xs font-semibold text-[var(--accent)] hover:underline"
                          >
                            Open file
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            {/* ---- What is and is not recorded --------------------------- */}
            <div className="flex flex-wrap items-start gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5 text-sm">
              <span className="mt-0.5 text-[var(--muted)]">
                <AlertIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold">What is recorded, and what never is</p>
                <p className="mt-1 text-[var(--muted)]">
                  Recorded: which page, for how long, on what kind of device, at what hour on the student&apos;s own
                  clock, and which buttons were pressed. Never recorded: anything a student typed — no message
                  contents, no search terms, no answers, no private chat. Students who ask to be left out are left
                  out, and the count of them is on this page rather than hidden.
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Last read {new Date(data.generatedAt).toLocaleString("en-GB")} · profiles rebuild every six hours,
                  or immediately when you press Recompute.
                </p>
              </div>
              <Link
                href="/admin/personalization"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--surface)]"
              >
                <TrendingUpIcon className="h-3.5 w-3.5" />
                Study plan health
              </Link>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
