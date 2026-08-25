"use client";

import { useEffect, useState } from "react";
import ParentShell, { useParentChildren } from "@/components/ParentShell";
import { AttendanceIcon } from "@/components/icons";

type AttendanceRecord = { date: string; status: string };
type AttendanceSummary = {
  present: number;
  total: number;
  basis: "cohort-register" | "private-sessions";
  records: AttendanceRecord[];
};

const STATUS_STYLE: Record<string, string> = {
  present: "border-emerald-300 bg-emerald-50 text-emerald-700",
  late: "border-amber-300 bg-amber-50 text-amber-700",
  absent: "border-red-300 bg-red-50 text-red-700",
  no_show: "border-red-300 bg-red-50 text-red-700",
  excused: "border-slate-300 bg-slate-50 text-slate-600",
  unrecorded: "border-slate-300 bg-slate-50 text-slate-600",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Attended",
  late: "Arrived late",
  absent: "Absent",
  no_show: "Did not join",
  excused: "Excused",
  unrecorded: "Not yet recorded",
};

const BASIS_COPY: Record<string, string> = {
  "cohort-register": "Based on days recorded by your child's tutor.",
  "private-sessions": "Based on your child's one-to-one sessions this month.",
};

function AttendanceBody() {
  const { children: kids, selectedId, loading: loadingKids } = useParentChildren();
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetch(`/api/parent/attendance?studentId=${selectedId}`)
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const child = kids.find((k) => k.id === selectedId);

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Attendance</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {child ? `${child.name.split(" ")[0]}'s attendance this month` : "Attendance this month"}
          </p>
        </div>

        {loadingKids || loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : !kids.length ? (
          <p className="text-sm text-[var(--muted)]">No child linked to this account yet.</p>
        ) : (
          <>
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <AttendanceIcon className="h-6 w-6" />
              </span>
              {summary && summary.total > 0 ? (
                <>
                  <p className="mt-4 text-3xl font-bold text-[var(--foreground)]">
                    {summary.present} / {summary.total}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">classes attended this month</p>
                </>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">No classes recorded yet this month.</p>
              )}
              {summary ? <p className="mt-3 text-xs text-[var(--muted)]">{BASIS_COPY[summary.basis]}</p> : null}
            </div>

            {summary && summary.records.length > 0 ? (
              <div className="space-y-2">
                {summary.records
                  .slice()
                  .reverse()
                  .map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                    >
                      <span className="text-sm text-[var(--foreground)]">
                        {new Date(r.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status] || STATUS_STYLE.unrecorded}`}
                      >
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function ParentAttendancePage() {
  return (
    <ParentShell>
      <AttendanceBody />
    </ParentShell>
  );
}
