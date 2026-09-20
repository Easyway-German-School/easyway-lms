"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

type Band = {
  key: string;
  label: string;
  count: number;
  sharePercent: number;
  avgAttendancePercent: number | null;
  avgProgressPercent: number | null;
};

type Summary = {
  total: number;
  known: number;
  unknown: number;
  averageAge: number | null;
  medianAge: number | null;
  olderCount: number;
  olderSharePercent: number;
  bands: Band[];
};

type CheckIn = {
  id: string;
  name: string;
  level: string;
  age: number | null;
  attendancePercent: number | null;
  progressPercent: number | null;
};

type Report = { summary: Summary; olderFrom: number; checkIn: CheckIn[] };

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-3xl font-black text-[var(--foreground)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export default function AgeReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/reports/age", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Could not load the age report.");
        return data as Report;
      })
      .then((data) => active && setReport(data))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load the age report."));
    return () => {
      active = false;
    };
  }, []);

  const summary = report?.summary;
  const tallest = summary ? Math.max(1, ...summary.bands.map((b) => b.count)) : 1;

  return (
    <AdminShell>
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-8">
        <Link href="/admin/reports" className="text-sm font-semibold text-[var(--accent)]">
          ← Reports
        </Link>
        <h1 className="mt-3 text-3xl font-black text-[var(--foreground)]">Who&apos;s learning with us, by age</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          Active students only, grouped by age. Use it to see whether older learners are keeping up — and to spot
          the ones worth a friendly phone call before they give up on the portal.
        </p>

        {error ? <p className="mt-6 text-sm font-semibold text-red-600">{error}</p> : null}
        {!report && !error ? <p className="mt-6 text-sm text-[var(--muted)]">Loading…</p> : null}

        {summary ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Students" value={String(summary.total)} hint={`${summary.known} with a birth date on file`} />
              <Stat
                label="Average age"
                value={summary.averageAge === null ? "—" : String(Math.round(summary.averageAge))}
                hint={summary.medianAge === null ? undefined : `Median ${Math.round(summary.medianAge)}`}
              />
              <Stat
                label={`Aged ${report.olderFrom}+`}
                value={String(summary.olderCount)}
                hint={`${summary.olderSharePercent}% of students with a known age`}
              />
              <Stat
                label="Age unknown"
                value={String(summary.unknown)}
                hint={summary.unknown ? "No usable birth date on file" : "Everyone has one"}
              />
            </div>

            <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Age ranges</h2>
              <div className="mt-4 grid gap-3">
                {summary.bands.map((band) => (
                  <div key={band.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="font-semibold text-[var(--foreground)]">{band.label}</span>
                    <div className="h-3 overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(band.count / tallest) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 text-right tabular-nums text-[var(--muted)]">
                      {band.count} · {band.sharePercent}%
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Are they keeping up?</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Average class attendance and course progress in each age range. A band that sits well below the rest
                is where the portal, or the teaching, may not be working.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="py-2">Age</th>
                      <th className="py-2">Students</th>
                      <th className="py-2">Attendance</th>
                      <th className="py-2">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.bands.map((band) => (
                      <tr key={band.key} className="border-t border-[var(--border)]">
                        <td className="py-2 font-semibold text-[var(--foreground)]">{band.label}</td>
                        <td className="py-2 tabular-nums">{band.count}</td>
                        <td className="py-2 tabular-nums">{pct(band.avgAttendancePercent)}</td>
                        <td className="py-2 tabular-nums">{pct(band.avgProgressPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-6 dark:border-amber-500/40 dark:bg-amber-500/10">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Worth a friendly call</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Students aged {report.olderFrom}+ with the lowest attendance and progress. Ask if the portal is
                giving them trouble — many will not say so unprompted.
              </p>
              {report.checkIn.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted)]">No students aged {report.olderFrom}+ yet.</p>
              ) : (
                <ul className="mt-4 grid gap-2">
                  {report.checkIn.map((person) => (
                    <li key={person.id}>
                      <Link
                        href={`/admin/students/${person.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-4 py-3 text-sm transition hover:brightness-95"
                      >
                        <span className="font-semibold text-[var(--foreground)]">
                          {person.name}
                          <span className="ml-2 font-normal text-[var(--muted)]">
                            {person.age} · {person.level}
                          </span>
                        </span>
                        <span className="tabular-nums text-[var(--muted)]">
                          Attendance {pct(person.attendancePercent)} · Progress {pct(person.progressPercent)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mt-6 text-xs text-[var(--muted)]">
              Students only. Tutors, parents and office staff have no birth date on file, so they are not counted.
            </p>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
