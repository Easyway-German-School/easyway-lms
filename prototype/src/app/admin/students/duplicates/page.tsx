"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { ArrowLeftIcon, UsersIcon } from "@/components/icons";
import type { DuplicateCluster, DuplicateMember, EmailKind } from "@/lib/student-duplicates";

/**
 * "Possible duplicates" — the same student entered twice, usually a returning
 * student who signed themselves up and was then imported again from a paper
 * form. Each cluster shows the row we would keep (most complete, most in use)
 * and the row(s) we would fold into it. Folding moves the duplicate's payments,
 * tuition charges, invoices, plans and guardians onto the keeper, fills the
 * keeper's blank fields, and retires the duplicate login. A duplicate with any
 * attendance or classwork is left for a person.
 */

type ApiResponse = {
  clusters: DuplicateCluster[];
  scanned: number;
  truncated: boolean;
  pairs: number;
  mergeable: number;
};

const EMAIL_LABEL: Record<EmailKind, string> = {
  typed: "real email",
  login: "phone login",
  placeholder: "placeholder email",
  missing: "no email",
};

const EMAIL_TONE: Record<EmailKind, string> = {
  typed: "bg-green-50 text-green-700 border-green-200",
  login: "bg-blue-50 text-blue-700 border-blue-200",
  placeholder: "bg-amber-50 text-amber-800 border-amber-200",
  missing: "bg-amber-50 text-amber-800 border-amber-200",
};

function activityLine(m: DuplicateMember): string {
  const bits: string[] = [];
  const a = m.activity;
  if (a.payments) bits.push(`${a.payments} payment${a.payments === 1 ? "" : "s"}`);
  if (a.tuitionCharges) bits.push(`${a.tuitionCharges} charge${a.tuitionCharges === 1 ? "" : "s"}`);
  if (a.attendance) bits.push(`${a.attendance} attendance`);
  if (a.submissions) bits.push(`${a.submissions} submitted`);
  if (a.grades) bits.push(`${a.grades} grade${a.grades === 1 ? "" : "s"}`);
  if (a.certificates) bits.push(`${a.certificates} certificate${a.certificates === 1 ? "" : "s"}`);
  return bits.length ? bits.join(" · ") : "no activity";
}

export default function DuplicatesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/students/duplicates", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setDone(new Set());
      } else {
        setMsg("Could not scan for duplicates.");
      }
    } catch {
      setMsg("Could not scan for duplicates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clusters = useMemo(
    () => (data?.clusters ?? []).filter((c) => !c.members.every((m) => done.has(m.studentId))),
    [data, done],
  );

  async function merge(cluster: DuplicateCluster, absorb: DuplicateMember) {
    const keeper = cluster.members.find((m) => m.studentId === cluster.keeperId);
    if (!keeper) return;
    if (
      !window.confirm(
        `Fold "${absorb.name}" (${absorb.email}) into "${keeper.name}" (${keeper.email})?\n\n` +
          `Payments, tuition charges, invoices, plans and guardians move onto the kept record. ` +
          `The duplicate login is retired. This is reversible from the audit trail.`,
      )
    ) {
      return;
    }
    setBusyKey(`${cluster.key}:${absorb.studentId}`);
    setMsg("");
    try {
      const res = await fetch("/api/admin/students/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keeperId: keeper.studentId, absorbId: absorb.studentId }),
      });
      const out = await res.json();
      if (res.ok) {
        const m = out.moved ?? {};
        setMsg(
          `Merged ${absorb.name} into ${keeper.name}. Moved ${m.payments ?? 0} payment(s), ` +
            `${m.chargesMoved ?? 0} charge(s), ${m.guardiansMoved ?? 0} guardian(s)` +
            (m.chargesDropped ? `, dropped ${m.chargesDropped} duplicate charge(s)` : "") +
            ".",
        );
        setDone((prev) => new Set(prev).add(absorb.studentId));
      } else {
        setMsg(out.error || "Could not merge those records.");
      }
    } catch {
      setMsg("Could not merge those records.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <Link
            href="/admin/students"
            className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon /> Back to students
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <UsersIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Possible duplicates</h1>
          </div>
          <p className="mt-2 max-w-3xl text-[var(--muted)]">
            Students who appear twice with the <strong>same name and phone number</strong> — usually a
            returning student who signed up themselves and was then imported again from a paper form.
            Fold the duplicate into the kept record: its payments, charges, invoices, plans and
            guardians move across and the spare login is retired. A duplicate with attendance or
            classwork is left for you to merge by hand.
          </p>
        </div>

        {msg && (
          <div className="rounded-lg bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--foreground)] shadow-sm">
            {msg}
          </div>
        )}

        {loading && <p className="text-[var(--muted)]">Scanning the roster…</p>}

        {data && !loading && (
          <p className="text-sm text-[var(--muted)]">
            Scanned {data.scanned.toLocaleString()} students
            {data.truncated && " (most recent 6,000)"} · {clusters.length} cluster
            {clusters.length === 1 ? "" : "s"} left · {data.mergeable} safe to fold in
            <button onClick={load} className="ml-3 text-[var(--accent)] underline">
              Rescan
            </button>
          </p>
        )}

        {data && !loading && clusters.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            Nothing to merge. Every student with a shared name and phone is either a single record or
            already handled.
          </div>
        )}

        {clusters.map((cluster) => (
          <div
            key={cluster.key}
            className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
          >
            <div className="border-b border-[var(--border)] bg-[var(--background)] px-5 py-3 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">
                {cluster.members[0].name || "(no name)"}
              </span>{" "}
              · {cluster.members.length} records
            </div>

            {cluster.reviewNote && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                {cluster.reviewNote}
              </div>
            )}

            <div className="divide-y divide-[var(--border)]">
              {cluster.members.map((m) => {
                const isKeeper = m.studentId === cluster.keeperId;
                const merged = done.has(m.studentId);
                const canFold = !isKeeper && !m.hasLearningHistory && !merged;
                const busy = busyKey === `${cluster.key}:${m.studentId}`;
                return (
                  <div
                    key={m.studentId}
                    className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${
                      merged ? "opacity-50" : ""
                    } ${isKeeper ? "bg-green-50/40" : ""}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--foreground)]">{m.name || "(no name)"}</span>
                        {isKeeper && (
                          <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                            Keep
                          </span>
                        )}
                        {merged && (
                          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
                            Merged
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${EMAIL_TONE[m.emailKind]}`}
                        >
                          {EMAIL_LABEL[m.emailKind]}
                        </span>
                      </div>
                      <div className="text-sm text-[var(--muted)]">{m.email || "—"}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {[
                          m.studentCode,
                          m.level,
                          m.branchName,
                          m.batch,
                          m.sessionSlot,
                          m.phone,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{activityLine(m)}</div>
                    </div>

                    <div className="shrink-0">
                      {isKeeper ? (
                        <Link
                          href={`/admin/students/${m.studentId}`}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--background)]"
                        >
                          Open
                        </Link>
                      ) : canFold ? (
                        <button
                          onClick={() => merge(cluster, m)}
                          disabled={busy}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          {busy ? "Merging…" : "Fold into keeper"}
                        </button>
                      ) : merged ? null : (
                        <Link
                          href={`/admin/students/${m.studentId}`}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--background)]"
                        >
                          Review by hand
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
