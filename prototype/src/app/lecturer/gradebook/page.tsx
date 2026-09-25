"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import { homePathForRole } from "@/lib/portal";
import {
  AlertIcon,
  AttendanceIcon,
  CheckIcon,
  DownloadIcon,
  EmptyIcon,
  ExamIcon,
  ResultsIcon,
  SearchIcon,
} from "@/components/icons";

/**
 * The gradebook.
 *
 * A tutor's roster down the side, one column per assessment, marks in the
 * cells — and every cell is editable in place. The page it replaced could only
 * show lesson-completion percentages for courses belonging to the whole
 * school, so a tutor could neither read a mark off it nor put one in.
 *
 * TWO LAYOUTS, ONE STATE. The grid is a real table on a screen wide enough to
 * hold six columns of marks and a per-student card stack below that width. It
 * is not a table with `overflow-x` and a scrollbar — a marks grid you have to
 * drag sideways to read, with the student's name scrolled off the left, is the
 * exact thing that makes a tutor give up and use paper.
 *
 * SAVING IS PER CELL. A tutor tabs across a row; each cell commits on blur or
 * Enter. There is no "save all" button to forget, and a phone locking halfway
 * down a class of thirty loses one cell rather than the lot.
 */

type Cell = { score: number; letter: string; feedback: string | null; markedAt: string } | null;

type Student = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  marks: Record<string, Cell>;
  average: number | null;
  letter: string | null;
  passing: boolean | null;
  marked: number;
  outstanding: number;
  trend: number | null;
  sparkline: number[];
  attendance: { held: number; present: number; late: number; percent: number } | null;
  exams: Array<{ id: string; name: string; score: number; letter: string; at: string; body: string; resultsReleased: boolean }>;
};

type Column = {
  type: string;
  required: boolean;
  marked: number;
  missing: number;
  average: number | null;
  passRate: number | null;
};

type ClassStats = {
  students: number;
  graded: number;
  ungraded: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  passRate: number | null;
  outstanding: number;
  distribution: Array<{ letter: string; count: number }>;
};

type Payload = {
  assigned: boolean;
  types: string[];
  weights?: Record<string, number>;
  passMark?: number;
  students: Student[];
  columns?: Column[];
  classStats: ClassStats | null;
  message?: string;
};

type SortKey = "name" | "average" | "trend" | "outstanding" | "attendance";

const LETTER_TONE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-sky-100 text-sky-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-rose-100 text-rose-800",
};

function toneFor(letter: string | null) {
  return letter ? LETTER_TONE[letter] ?? "bg-[var(--surface-alt)] text-[var(--foreground-soft)]" : "bg-[var(--surface-alt)] text-[var(--muted)]";
}

/** A score's own colour, so a grid of numbers reads as a heat map at a glance. */
function scoreTint(score: number | undefined, passMark: number) {
  if (score === undefined) return "";
  if (score >= 85) return "text-emerald-700";
  if (score >= passMark) return "text-sky-700";
  if (score >= passMark - 10) return "text-amber-700";
  return "text-rose-700";
}

/* ------------------------------------------------------------------ pieces */

/** Twelve marks in twenty pixels: the shape of a term, not the numbers in it. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-xs text-[var(--muted)]">—</span>;
  const width = 60;
  const height = 20;
  const step = width / (points.length - 1);
  const d = points
    .map((score, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - (score / 100) * height).toFixed(1)}`)
    .join(" ");
  const rising = points[points.length - 1] >= points[0];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-5 w-[60px]" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={rising ? "#059669" : "#e11d48"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendBadge({ trend }: { trend: number | null }) {
  if (trend === null) return <span className="text-xs text-[var(--muted)]">—</span>;
  if (trend === 0) return <span className="text-xs font-semibold text-[var(--muted)]">level</span>;
  const up = trend > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-bold ${
        up ? "text-emerald-600" : "text-rose-600"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(trend)}
    </span>
  );
}

/**
 * One editable mark.
 *
 * Local draft state, committed on blur or Enter and reverted on Escape. The
 * server is the source of truth for the letter, so the cell waits for the
 * response rather than computing a letter itself and risking a grid that
 * disagrees with the student's results page.
 */
function MarkCell({
  value,
  passMark,
  disabled,
  onCommit,
}: {
  value: Cell;
  passMark: number;
  disabled: boolean;
  onCommit: (score: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ? String(value.score) : "");
  const [busy, setBusy] = useState(false);
  const committed = useRef(value ? String(value.score) : "");

  // Re-sync when the row is refreshed from the server (a reload, a sort, or
  // another cell's save returning fresh totals).
  useEffect(() => {
    const next = value ? String(value.score) : "";
    committed.current = next;
    setDraft(next);
  }, [value]);

  async function commit() {
    if (draft === committed.current) return;
    setBusy(true);
    try {
      await onCommit(draft);
      committed.current = draft;
    } catch {
      setDraft(committed.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      inputMode="numeric"
      type="number"
      min={0}
      max={100}
      disabled={disabled || busy}
      value={draft}
      placeholder="—"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(committed.current);
          event.currentTarget.blur();
        }
      }}
      title={value?.feedback ?? undefined}
      className={`w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center text-sm font-bold tabular-nums transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 disabled:opacity-50 ${scoreTint(
        value?.score,
        passMark,
      )}`}
    />
  );
}

/* -------------------------------------------------------------------- page */

export default function GradebookPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/gradebook", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not load your gradebook");
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your gradebook");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/lecturer/signin");
      return;
    }
    if (status === "authenticated") {
      const role = ((session as { user?: { role?: string } })?.user?.role ?? "").toLowerCase();
      if (!(role === "lecturer" || role === "admin")) {
        // Send them to their OWN portal, not to the student one on the
        // assumption that anybody who is not a tutor must be a student.
        router.push(homePathForRole(role));
        return;
      }
      load();
    }
  }, [status, session, router, load]);

  const passMark = data?.passMark ?? 60;
  const types = data?.types ?? [];

  async function saveCell(studentId: string, type: string, score: string) {
    // One confirm before a big swing lands on a permanent record. Checked
    // against this student's existing mark for the same skill, or failing that
    // their overall average — a 30-point drop is nearly always a slip.
    if (score.trim() !== "") {
      const next = Number(score);
      const student = data?.students.find((row) => row.id === studentId);
      const previous = student?.marks[type]?.score ?? null;
      const reference = previous ?? student?.average ?? null;
      if (
        student &&
        Number.isFinite(next) &&
        reference !== null &&
        reference - next >= (previous === null ? 30 : 25)
      ) {
        const label = previous === null ? "their average" : `their last ${type} mark`;
        const ok = window.confirm(
          `Save ${next} for ${student.name}? That is well below ${label} (${reference}).`,
        );
        // Throwing makes the cell revert to what was there before.
        if (!ok) throw new Error("cancelled");
      }
    }

    const res = await fetch("/api/lecturer/gradebook", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, type, score: score.trim() === "" ? "" : Number(score) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "That mark did not save");
      throw new Error(payload.error || "save failed");
    }
    setError("");
    setSavedAt(`${studentId}:${type}`);
    window.setTimeout(() => setSavedAt((current) => (current === `${studentId}:${type}` ? null : current)), 1600);
    // Averages, trends and the class figures all move when one cell does, so
    // the whole book is refetched rather than patched by hand in the browser —
    // half-updated totals are worse than a moment's wait.
    await load();
  }

  async function toggleRelease(examId: string) {
    const response = await fetch("/api/lecturer/results/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not update result release");
    await load();
  }

  const levels = useMemo(() => {
    const set = new Set((data?.students ?? []).map((student) => student.level));
    return ["all", ...Array.from(set).sort()];
  }, [data]);

  const visible = useMemo(() => {
    let rows = data?.students ?? [];
    const needle = query.trim().toLowerCase();

    if (needle) {
      rows = rows.filter(
        (student) =>
          student.name.toLowerCase().includes(needle) ||
          student.email.toLowerCase().includes(needle) ||
          (student.studentCode ?? "").toLowerCase().includes(needle),
      );
    }
    if (level !== "all") rows = rows.filter((student) => student.level === level);
    if (onlyOutstanding) rows = rows.filter((student) => student.outstanding > 0);

    // A null average sorts last on every numeric key — an unmarked student is
    // not a student who scored zero.
    const last = (value: number | null) => (value === null ? -1 : value);

    return [...rows].sort((a, b) => {
      switch (sort) {
        case "average":
          return last(b.average) - last(a.average);
        case "trend":
          return last(b.trend) - last(a.trend);
        case "outstanding":
          return b.outstanding - a.outstanding;
        case "attendance":
          return last(b.attendance?.percent ?? null) - last(a.attendance?.percent ?? null);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [data, query, level, sort, onlyOutstanding]);

  /** The book as a spreadsheet. Built in the browser — the data is already here. */
  function exportCsv() {
    const header = ["Student", "Code", "Level", "Session", ...types, "Average", "Grade", "Attendance %"];
    const lines = visible.map((student) =>
      [
        student.name,
        student.studentCode ?? "",
        student.level,
        student.sessionSlot,
        ...types.map((type) => student.marks[type]?.score ?? ""),
        student.average ?? "",
        student.letter ?? "",
        student.attendance?.percent ?? "",
      ]
        // Quote everything: a student's name can contain a comma and one such
        // name shifts every column after it by one.
        .map((field) => `"${String(field).replace(/"/g, '""')}"`)
        .join(","),
    );

    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gradebook-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---------------------------------------------------------- early exits */

  if (loading) {
    return (
      <LecturerShell>
        <div className="space-y-3 p-4 sm:p-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-[var(--surface-alt)]" />
          ))}
        </div>
      </LecturerShell>
    );
  }

  if (data && !data.assigned) {
    return (
      <LecturerShell>
        <div className="p-4 sm:p-6">
          <div className="rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-900">
            <p className="flex items-center gap-2 font-bold">
              <AlertIcon className="h-5 w-5" /> No class assigned yet
            </p>
            <p className="mt-2 text-sm">{data.message}</p>
          </div>
        </div>
      </LecturerShell>
    );
  }

  const stats = data?.classStats;

  return (
    <LecturerShell>
      {/* min-w-0 so a wide table can never push the whole shell sideways. */}
      <div className="min-w-0 space-y-5 p-3 sm:p-6">
        <header className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            <ResultsIcon className="h-6 w-6 shrink-0 text-[var(--accent)] sm:h-7 sm:w-7" />
            Gradebook
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every student you teach and every mark they have. Type in a cell to record a score —
            it saves as you go, and the student sees it on their results page.
          </p>
        </header>

        {error && (
          <p className="flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {/* ---- Class figures ------------------------------------------- */}
        {stats && (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <Stat
              label="Class average"
              value={stats.average ?? "—"}
              hint={`over ${stats.graded} marked student${stats.graded === 1 ? "" : "s"}`}
            />
            <Stat
              label="Passing"
              value={stats.passRate === null ? "—" : `${stats.passRate}%`}
              hint={`${stats.graded} of ${stats.students} marked`}
            />
            <Stat
              label="Range"
              value={stats.highest === null ? "—" : `${stats.lowest}–${stats.highest}`}
              hint="lowest to highest"
            />
            <Stat
              label="Marks owed"
              value={stats.outstanding}
              hint={stats.outstanding === 0 ? "all up to date" : "empty cells to fill"}
              alert={stats.outstanding > 0}
            />
          </div>
        )}

        {/* ---- Per-skill class averages -------------------------------- */}
        {data?.columns && data.columns.some((column) => column.marked > 0) && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-bold text-[var(--foreground)]">How the class is doing, by skill</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.columns.map((column) => (
                <div key={column.type} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-bold capitalize text-[var(--foreground)]">
                      {column.type}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--muted)]">
                      {column.average ?? "—"}
                      {column.required && column.missing > 0 && (
                        <span className="ml-1.5 font-medium text-amber-600">{column.missing} left</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className={`h-full rounded-full ${
                        (column.average ?? 0) >= passMark ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      style={{ width: `${column.average ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- Controls -------------------------------------------------
            Stacked on a phone. Four controls of four different widths
            wrapping into a ragged block is exactly the clutter this page had
            everywhere else. */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a student"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] py-2.5 pl-9 pr-3 text-sm text-[var(--foreground)]"
            />
          </label>

          <div className="flex gap-2.5">
            {levels.length > 2 && (
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)]"
              >
                {levels.map((option) => (
                  <option key={option} value={option}>
                    {option === "all" ? "All levels" : option}
                  </option>
                ))}
              </select>
            )}

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)]"
            >
              <option value="name">Sort: name</option>
              <option value="average">Sort: average</option>
              <option value="trend">Sort: moving up</option>
              <option value="outstanding">Sort: unmarked first</option>
              <option value="attendance">Sort: attendance</option>
            </select>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setOnlyOutstanding((current) => !current)}
              aria-pressed={onlyOutstanding}
              className={`flex-1 whitespace-nowrap rounded-xl border px-3 py-2.5 text-sm font-semibold transition sm:flex-none ${
                onlyOutstanding
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              Needs marking
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <DownloadIcon className="h-4 w-4" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] p-10 text-center">
            <EmptyIcon className="mx-auto h-10 w-10 text-[var(--muted)]" />
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {data?.students.length === 0 ? "Nobody is registered for your class yet" : "No student matches that"}
            </p>
            {data?.message && <p className="mt-1 text-sm text-[var(--muted)]">{data.message}</p>}
          </div>
        ) : (
          <>
            {/* ---- The grid, on a screen wide enough for it ------------- */}
            <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] xl:block">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="w-[19%] px-3 py-3 text-left font-semibold">Student</th>
                    {types.map((type) => (
                      <th key={type} className="px-2 py-3 text-center font-semibold capitalize">
                        {type}
                        {data?.weights?.[type] !== undefined && data.weights[type] !== 1 && (
                          <span className="ml-1 font-normal normal-case">×{data.weights[type]}</span>
                        )}
                      </th>
                    ))}
                    <th className="w-[9%] px-2 py-3 text-center font-semibold">Average</th>
                    <th className="w-[8%] px-2 py-3 text-center font-semibold">Trend</th>
                    <th className="w-[9%] px-2 py-3 text-center font-semibold">Present</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((student) => (
                    <tr key={student.id} className="border-t border-[var(--border)]/60 align-middle">
                      <td className="px-3 py-2">
                        <p className="truncate font-semibold text-[var(--foreground)]">{student.name}</p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {student.studentCode || student.email} · {student.level}
                        </p>
                      </td>

                      {types.map((type) => (
                        <td key={type} className="relative px-2 py-2">
                          <MarkCell
                            value={student.marks[type]}
                            passMark={passMark}
                            disabled={false}
                            onCommit={(score) => saveCell(student.id, type, score)}
                          />
                          {savedAt === `${student.id}:${type}` && (
                            <CheckIcon className="pointer-events-none absolute right-3 top-1.5 h-3.5 w-3.5 text-emerald-600" />
                          )}
                        </td>
                      ))}

                      <td className="px-2 py-2 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold tabular-nums ${toneFor(
                            student.letter,
                          )}`}
                        >
                          {student.average ?? "—"} {student.letter ?? ""}
                        </span>
                      </td>

                      <td className="px-2 py-2">
                        <div className="flex flex-col items-center gap-0.5">
                          <Sparkline points={student.sparkline} />
                          <TrendBadge trend={student.trend} />
                        </div>
                      </td>

                      <td className="px-2 py-2 text-center">
                        {student.attendance ? (
                          <span
                            className={`text-xs font-bold tabular-nums ${
                              student.attendance.percent >= 75 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {student.attendance.percent}%
                            <span className="block font-normal text-[var(--muted)]">
                              {student.attendance.present}/{student.attendance.held}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---- The same book, as cards -----------------------------
                Below xl the table becomes one card per student. Six mark
                inputs sit in a 2- or 3-up grid inside the card, so nothing is
                ever off the side of the screen and the student's name stays
                attached to their marks. */}
            <div className="space-y-3 xl:hidden">
              {visible.map((student) => {
                const open = expanded === student.id;
                return (
                  <div
                    key={student.id}
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : student.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 p-3.5 text-left"
                    >
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-black ${toneFor(
                          student.letter,
                        )}`}
                      >
                        {student.average ?? "—"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-[var(--foreground)]">
                          {student.name}
                        </span>
                        <span className="block truncate text-xs text-[var(--muted)]">
                          {student.studentCode || student.email} · {student.level}
                        </span>
                      </span>

                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <TrendBadge trend={student.trend} />
                        {student.outstanding > 0 && (
                          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            {student.outstanding} to mark
                          </span>
                        )}
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-[var(--border)] bg-[var(--surface-alt)] p-3.5">
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                          {types.map((type) => (
                            <label key={type} className="min-w-0">
                              <span className="mb-1 block truncate text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                                {type}
                              </span>
                              <MarkCell
                                value={student.marks[type]}
                                passMark={passMark}
                                disabled={false}
                                onCommit={(score) => saveCell(student.id, type, score)}
                              />
                            </label>
                          ))}
                        </div>

                        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                          <span className="inline-flex items-center gap-1.5">
                            <AttendanceIcon className="h-3.5 w-3.5" />
                            {student.attendance
                              ? `${student.attendance.percent}% present (${student.attendance.present}/${student.attendance.held})`
                              : "No register yet"}
                          </span>
                          <span>{student.marked} of {types.length} marked</span>
                        </div>

                        {student.exams.length > 0 && (
                          <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                              Exam sittings
                            </p>
                            {student.exams.map((exam) => (
                              <p key={`${exam.name}-${exam.at}`} className="mt-1 flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0 truncate text-[var(--foreground)]">{exam.name}</span>
                                <span className="flex shrink-0 items-center gap-2"><span className="font-bold tabular-nums">{exam.score} {exam.letter}</span><button type="button" onClick={() => toggleRelease(exam.id).catch((error) => setError(error.message))} className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] font-semibold">{exam.resultsReleased ? "Hide" : "Release"}</button></span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="pb-2 text-center text-xs text-[var(--muted)]">
          A blank cell means &ldquo;not marked yet&rdquo;, not zero. Clear a cell to take a mark back.
        </p>

        {/* Exam sittings used to be their own page (Exam/Test). Folded in here
            so there is one grading link in the sidebar, not two — this is the
            other kind of mark a tutor gives: a booked sitting, scored as a
            whole and released to students as a batch, instead of a running
            classwork mark. */}
        <ExamSittingsSection />
      </div>
    </LecturerShell>
  );
}

function Stat({
  label,
  value,
  hint,
  suffix,
  alert,
}: {
  label: string;
  value: string | number;
  hint?: string;
  suffix?: string | null;
  alert?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-3.5 sm:p-4 ${
        alert ? "border-amber-300 bg-amber-50" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--foreground)]">
        {value}
        {suffix && <span className="ml-1 text-base font-semibold text-[var(--muted)]">{suffix}</span>}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------- exam sittings */

type ExamGradeSession = {
  id: string;
  examId: string;
  examName: string;
  courseId: string;
  courseName: string;
  totalStudents: number;
  gradedStudents: number;
  resultsReleased: boolean;
};

type ExamStudentGrade = {
  id: string;
  studentId: string;
  studentName: string;
  email: string;
  examName: string;
  score: number;
  totalScore: number;
  grade: string;
  studentCode?: string | null;
  feedback?: string;
  submissionMode?: string;
  graded?: boolean;
};

/**
 * A booked exam sitting, scored and released as a batch — the other shape of
 * grading, alongside the running classwork marks in the grid above. Ported
 * from the old standalone Exam/Test page: same two endpoints
 * (`/api/lecturer/grades`, `/api/lecturer/grades/students`), same release
 * toggle, so nothing about how a sitting is recorded changed — only where a
 * tutor finds it.
 */
function ExamSittingsSection() {
  const [sessions, setSessions] = useState<ExamGradeSession[]>([]);
  const [selectedExam, setSelectedExam] = useState("");
  const [students, setStudents] = useState<ExamStudentGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchSessions();
  }, []);

  async function fetchSessions() {
    try {
      const res = await fetch("/api/lecturer/grades");
      if (!res.ok) throw new Error("Failed to fetch exam sittings");
      const data = await res.json();
      setSessions(data.sessions);
      if (data.sessions.length > 0) {
        setSelectedExam(data.sessions[0].examId);
        await fetchStudents(data.sessions[0].examId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudents(examId: string) {
    try {
      const res = await fetch(`/api/lecturer/grades/students?examId=${examId}`);
      if (!res.ok) throw new Error("Failed to fetch students");
      const data = await res.json();
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch students");
    }
  }

  async function updateGrade(studentId: string, newScore: number, newFeedback?: string, newSubmissionMode?: string) {
    if (newScore < 0 || newScore > 100) {
      setError("Score must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/lecturer/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          examId: selectedExam,
          score: newScore,
          feedback: newFeedback,
          submissionMode: newSubmissionMode,
        }),
      });
      if (!res.ok) throw new Error("Failed to update grade");
      const updated = await res.json();
      setStudents(
        students.map((s) =>
          s.studentId === studentId
            ? {
                ...s,
                score: updated.score,
                grade: updated.grade,
                feedback: updated.feedback ?? "",
                submissionMode: updated.submissionMode ?? "platform",
                graded: true,
              }
            : s,
        ),
      );
      setEditingId(null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRelease() {
    if (!selectedExam) return;
    setReleasing(true);
    setError("");
    try {
      const res = await fetch("/api/lecturer/results/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId: selectedExam }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not update result release");
      setSessions((current) =>
        current.map((s) => (s.examId === selectedExam ? { ...s, resultsReleased: payload.resultsReleased } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update result release");
    } finally {
      setReleasing(false);
    }
  }

  const selectedSession = sessions.find((s) => s.examId === selectedExam);

  if (loading) {
    return (
      <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="h-20 animate-pulse rounded-xl bg-[var(--surface-alt)]" />
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
        <ExamIcon className="h-5 w-5 text-[var(--accent)]" />
        Exam sittings
      </h2>
      <p className="mb-4 -mt-2 text-sm text-[var(--muted)]">
        Students who booked a sitting, scored as a whole exam rather than a running mark. Release
        publishes every graded score on this sitting to students at once.
      </p>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-700">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          No students have booked an exam sitting yet.
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
            <div className="filter-grid">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Choose Exam/Test</label>
                <select
                  value={selectedExam}
                  onChange={(e) => {
                    setSelectedExam(e.target.value);
                    void fetchStudents(e.target.value);
                  }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)]"
                >
                  {sessions.map((s) => (
                    <option key={s.examId} value={s.examId}>
                      {s.examName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Course</label>
                <div className="rounded-lg bg-[var(--surface-alt)] px-4 py-2 text-sm text-[var(--foreground)]">
                  {selectedSession?.courseName || "N/A"}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Progress</label>
                <div className="rounded-lg bg-[var(--surface-alt)] px-4 py-2 text-sm text-[var(--foreground)]">
                  {selectedSession?.gradedStudents ?? 0} / {selectedSession?.totalStudents ?? 0}
                </div>
              </div>
            </div>

            {selectedSession && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <div className="text-sm">
                  <p className="font-semibold text-[var(--foreground)]">
                    {selectedSession.resultsReleased ? "Results are visible to students" : "Results are hidden from students"}
                  </p>
                  <p className="text-[var(--muted)]">
                    {selectedSession.resultsReleased
                      ? "Every graded student can see their score on their results page."
                      : "Students cannot see any score for this sitting yet."}
                  </p>
                </div>
                <button
                  onClick={toggleRelease}
                  disabled={releasing}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    selectedSession.resultsReleased ? "bg-[var(--muted)] hover:opacity-90" : "bg-[var(--accent)] hover:opacity-90"
                  }`}
                >
                  {releasing ? "Saving…" : selectedSession.resultsReleased ? "Hide results" : "Release results"}
                </button>
              </div>
            )}
          </div>

          {students.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
              No students for this exam.
            </div>
          ) : (
            <div className="overflow-hidden overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Student</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Score</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Grade</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Sat</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.studentId} className="border-b border-[var(--border)] transition-colors last:border-b-0 hover:bg-[var(--surface-alt)]">
                      <td className="px-4 py-3 text-sm text-[var(--foreground)]">
                        {student.studentName}
                        {student.studentCode && <span className="ml-2 font-mono text-xs text-[var(--muted)]">{student.studentCode}</span>}
                        {editingId === student.studentId ? (
                          <input
                            id={`gb-feedback-${student.studentId}`}
                            defaultValue={student.feedback ?? ""}
                            placeholder="Feedback for this student (optional)"
                            className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          />
                        ) : student.feedback ? (
                          <p className="mt-1 text-xs italic text-[var(--muted)]">{student.feedback}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            defaultValue={student.score}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const fb = (document.getElementById(`gb-feedback-${student.studentId}`) as HTMLInputElement | null)?.value;
                                const mode = (document.getElementById(`gb-mode-${student.studentId}`) as HTMLSelectElement | null)?.value;
                                void updateGrade(student.studentId, parseInt(e.currentTarget.value), fb, mode);
                              }
                            }}
                            autoFocus
                            className="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center text-[var(--foreground)]"
                          />
                        ) : (
                          <span className={`font-semibold ${student.graded === false ? "text-[var(--muted)]" : "text-[var(--foreground)]"}`}>
                            {student.graded === false ? "—" : student.score}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${toneFor(student.grade)}`}>{student.grade}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <select
                            id={`gb-mode-${student.studentId}`}
                            defaultValue={student.submissionMode ?? "platform"}
                            className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)]"
                          >
                            <option value="platform">On platform</option>
                            <option value="physical">On paper</option>
                          </select>
                        ) : student.graded === false ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              student.submissionMode === "physical" ? "bg-purple-100 text-purple-700" : "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
                            }`}
                          >
                            {student.submissionMode === "physical" ? "Paper" : "Platform"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                const feedbackEl = document.getElementById(`gb-feedback-${student.studentId}`) as HTMLInputElement | null;
                                const scoreEl = feedbackEl?.closest("tr")?.querySelector<HTMLInputElement>("input[type=number]");
                                const modeEl = document.getElementById(`gb-mode-${student.studentId}`) as HTMLSelectElement | null;
                                void updateGrade(student.studentId, parseInt(scoreEl?.value ?? String(student.score)), feedbackEl?.value, modeEl?.value);
                              }}
                              disabled={saving}
                              className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button onClick={() => setEditingId(null)} className="rounded border border-[var(--border)] px-3 py-1 text-sm">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingId(student.studentId)}
                            disabled={saving}
                            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
