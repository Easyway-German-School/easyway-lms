"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { LevelUpIcon } from "@/components/icons";

/**
 * Next-level pipeline.
 *
 * Everyone who has just finished a level (or been moved up and is waiting on
 * the new intake), with where they stand in Becca's next-level journey:
 *
 *   hasn't opened it → opened → details in (holding a seat) → deposit → paid
 *
 * The students who have gone quiet sort to the top — those are today's phone
 * calls. One button has Becca send them a personal reminder. Details a student
 * gives (phone, parent phone, preferred sitting, note) show here and are
 * already written to their record.
 */

type Stage = "not_opened" | "opened" | "held" | "deposit_paid" | "paid_in_full";

type Row = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  branch: string | null;
  state: "signed_off" | "promoted" | "ended";
  finishedLevel: string;
  targetLevel: string;
  stage: Stage;
  stageLabel: string;
  phone: string | null;
  parentPhone: string | null;
  requestedSlot: string | null;
  requestedMode: string | null;
  note: string | null;
  seenAt: string | null;
  heldAt: string | null;
  priorOwed: number;
};

type Payload = { rows: Row[]; counts: Record<Stage, number> };

const TONE: Record<Stage, string> = {
  not_opened: "bg-rose-500/15 text-rose-700",
  opened: "bg-amber-500/15 text-amber-700",
  held: "bg-sky-500/15 text-sky-700",
  deposit_paid: "bg-emerald-500/15 text-emerald-700",
  paid_in_full: "bg-emerald-600/20 text-emerald-800",
};

const STATE_LABEL: Record<Row["state"], string> = {
  signed_off: "Signed off",
  promoted: "Moved up — waiting for intake",
  ended: "Batch ended",
};

const STAGES: Stage[] = ["not_opened", "opened", "held", "deposit_paid", "paid_in_full"];

export default function NextLevelPipelinePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/next-level", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load");
      setData(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => filter === "all" || r.stage === filter),
    [data, filter],
  );
  const nudgeable = rows.filter((r) => r.stage === "not_opened" || r.stage === "opened");

  async function nudge(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/next-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "nudge", studentIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not send");
      setMessage(`Becca reminded ${json.sent} student${json.sent === 1 ? "" : "s"}.`);
      setSelected(new Set());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]">
          <LevelUpIcon className="h-7 w-7 text-[var(--accent)]" />
          Next level
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          Everyone who has just finished a level, and where each one stands in Becca&apos;s next-level journey. The
          quiet ones are at the top — they are today&apos;s calls. Moving people up still happens on{" "}
          <Link href="/admin/graduation" className="font-semibold text-[var(--accent)] underline">
            Graduation
          </Link>
          .
        </p>

        {error && <p className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {data && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
              {STAGES.map((st) => (
                <button
                  key={st}
                  onClick={() => setFilter(filter === st ? "all" : st)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    filter === st ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <p className="text-3xl font-black text-[var(--foreground)]">{data.counts[st]}</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                    {data.rows.find((r) => r.stage === st)?.stageLabel ??
                      { not_opened: "Hasn't opened it yet", opened: "Opened the journey", held: "Details in — holding a seat", deposit_paid: "Deposit paid", paid_in_full: "Paid in full" }[st]}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                disabled={busy || nudgeable.length === 0}
                onClick={() => nudge(nudgeable.map((r) => r.studentId))}
                className="rounded-full btn-glow px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Remind everyone who hasn&apos;t kept a seat ({nudgeable.length})
              </button>
              <button
                disabled={busy || selected.size === 0}
                onClick={() => nudge([...selected])}
                className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
              >
                Remind selected ({selected.size})
              </button>
              {message && <span className="text-sm font-semibold text-emerald-700">{message}</span>}
            </div>

            <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-[var(--surface-alt)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="w-10 px-4 py-3" />
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Journey</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">What they told us</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-[var(--muted)]">
                        Nobody here yet. Students appear the day after their batch ends.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.studentId} className="border-t border-[var(--border)] align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.studentId)}
                          onChange={() => toggle(r.studentId)}
                          aria-label={`Select ${r.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/students/${r.studentId}`} className="font-semibold text-[var(--foreground)] hover:underline">
                          {r.name}
                        </Link>
                        <p className="text-xs text-[var(--muted)]">
                          {r.studentCode ? `${r.studentCode} · ` : ""}
                          {r.branch ?? "No branch"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--foreground)]">
                          {r.finishedLevel} → {r.targetLevel}
                        </p>
                        <p className="text-xs text-[var(--muted)]">{STATE_LABEL[r.state]}</p>
                        {r.priorOwed > 0 && (
                          <p className="text-xs font-semibold text-amber-700">Owes ₦{r.priorOwed.toLocaleString()} on {r.finishedLevel}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[r.stage]}`}>{r.stageLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {r.heldAt || r.phone ? (
                          <>
                            {r.phone && <p>Phone: <span className="text-[var(--foreground)]">{r.phone}</span></p>}
                            {r.parentPhone && <p>Parent: <span className="text-[var(--foreground)]">{r.parentPhone}</span></p>}
                            {r.requestedSlot && <p>Wants: <span className="text-[var(--foreground)]">{r.requestedSlot} sitting{r.requestedMode ? `, ${r.requestedMode}` : ""}</span></p>}
                            {r.note && <p className="mt-1 italic">&ldquo;{r.note}&rdquo;</p>}
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!data && !error && <p className="mt-8 text-[var(--muted)]">Loading…</p>}
      </div>
    </AdminShell>
  );
}
