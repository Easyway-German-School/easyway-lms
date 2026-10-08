"use client";

import { useEffect, useMemo, useState } from "react";

import AdminShell from "@/components/AdminShell";
import { DownloadIcon, RefreshIcon } from "@/components/icons";

type ReferralStudent = {
  id: string;
  referralCode: string;
  studentCode: string | null;
  createdAt: string;
  user: { name: string | null; email: string };
  branch: { name: string } | null;
  _count: { referralsGiven: number };
};

type Redemption = {
  id: string;
  referralCode: string;
  status: string;
  createdAt: string;
  referrerStudent: {
    user: { name: string | null; email: string };
    studentCode: string | null;
    branch: { name: string } | null;
  };
  referredStudent: {
    user: { name: string | null; email: string };
    studentCode: string | null;
    branch: { name: string } | null;
  };
  _count: { holds: number };
};

type Hold = {
  id: string;
  reason: string;
  heldAt: string;
  redemption: {
    referralCode: string;
    referrerStudent: { user: { name: string | null } };
    referredStudent: { user: { name: string | null } };
  };
};

type ReferralData = {
  students: ReferralStudent[];
  redemptions: Redemption[];
  holds: Hold[];
  totalRedemptions: number;
  openHolds: number;
  truncated: boolean;
};

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function AdminReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/referrals", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load referral records.");
        return body as ReferralData;
      })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load referral records.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data?.students ?? [];
    return (data?.students ?? []).filter((student) =>
      [student.user.name, student.user.email, student.referralCode, student.studentCode, student.branch?.name]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [data?.students, search]);

  async function copyLink(code: string) {
    const link = `${window.location.origin}/auth/signup?ref=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(`Referral link copied for ${code}.`);
      setError("");
    } catch {
      setError("Could not copy the referral link. Check browser clipboard permissions.");
      setNotice("");
    }
  }

  function downloadCsv() {
    const rows = [
      ["Student code", "Name", "Email", "Branch", "Referral code", "Registered referrals"],
      ...filteredStudents.map((student) => [
        student.studentCode,
        student.user.name,
        student.user.email,
        student.branch?.name,
        student.referralCode,
        student._count.referralsGiven,
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `easyway-referrals-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminShell>
      <main className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Referrals</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Student referral codes and registrations attributed to them. This is tracking only; no rewards or
              payouts are issued automatically.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError("");
                setRefreshKey((key) => key + 1);
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!filteredStudents.length}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <DownloadIcon className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Referral codes", value: data?.students.length ?? 0 },
            { label: "Attributed registrations", value: data?.totalRedemptions ?? 0 },
            { label: "Open holds", value: data?.openHolds ?? 0 },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm text-[var(--muted)]">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{loading ? "…" : metric.value.toLocaleString()}</p>
            </div>
          ))}
        </section>

        {data?.truncated ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            This view is capped for performance. The code list, registrations, or holds may be incomplete.
          </p>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Student codes</h2>
              <p className="text-sm text-[var(--muted)]">Copy a link to share; a registration via the link is recorded here.</p>
            </div>
            <input
              aria-label="Search referral codes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, code or branch"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm sm:max-w-sm"
            />
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading referral records…</p>
          ) : filteredStudents.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              {data?.students.length ? "No referral codes match this search." : "No student referral codes are available."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Branch</th>
                    <th className="px-3 py-3">Referral code</th>
                    <th className="px-3 py-3">Registrations</th>
                    <th className="px-3 py-3">Joined</th>
                    <th className="px-3 py-3">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredStudents.map((student) => (
                    <tr key={student.id}>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{student.user.name || "Student"}</p>
                        <p className="text-xs text-[var(--muted)]">{student.user.email}</p>
                      </td>
                      <td className="px-3 py-3">{student.branch?.name ?? "—"}</td>
                      <td className="px-3 py-3 font-mono font-bold">{student.referralCode}</td>
                      <td className="px-3 py-3 tabular-nums">{student._count.referralsGiven}</td>
                      <td className="px-3 py-3">{date(student.createdAt)}</td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => void copyLink(student.referralCode)} className="font-semibold text-[var(--accent-ink)] hover:underline">
                          Copy link
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">Attributed registrations</h2>
            <p className="text-sm text-[var(--muted)]">A registration is recorded when a new student signs up using a referral link.</p>
          </div>
          {!data?.redemptions.length ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">No registrations have been attributed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3">Referred student</th>
                    <th className="px-3 py-3">Referred by</th>
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.redemptions.map((redemption) => (
                    <tr key={redemption.id}>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{redemption.referredStudent.user.name || "Student"}</p>
                        <p className="text-xs text-[var(--muted)]">{redemption.referredStudent.user.email}</p>
                      </td>
                      <td className="px-3 py-3">{redemption.referrerStudent.user.name || "Student"}</td>
                      <td className="px-3 py-3 font-mono">{redemption.referralCode}</td>
                      <td className="px-3 py-3 capitalize">{redemption.status}</td>
                      <td className="px-3 py-3">{date(redemption.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">Open referral holds</h2>
            <p className="text-sm text-[var(--muted)]">Holds are recorded for review only; this page does not release or pay rewards.</p>
          </div>
          {!data?.holds.length ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">There are no open holds.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.holds.map((hold) => (
                <li key={hold.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{hold.redemption.referredStudent.user.name || "Student"} referred by {hold.redemption.referrerStudent.user.name || "Student"}</p>
                    <p className="text-[var(--muted)]">{hold.reason}</p>
                  </div>
                  <time className="text-xs text-[var(--muted)]">{date(hold.heldAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AdminShell>
  );
}
