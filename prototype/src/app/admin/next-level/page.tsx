"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { LevelUpIcon } from "@/components/icons";

/**
 * Next-level pipeline.
 *
 * Everyone who has just finished a level, been moved up, or is a month into
 * theirs — and where each stands in Becca's next-level journey:
 *
 *   hasn't opened it → opened → details in (holding a seat) → deposit → paid
 *
 * One button sends the message: the bell, the push and a designed email with
 * each student's own numbers, while the Becca pop shows on their dashboard at
 * the same moment. Nothing to write — read the preview, press send.
 *
 * Only students whose portal is OPEN (paid at least the deposit) are messaged.
 * Locked students stay on the list, marked, and are never contacted from here.
 */

type Stage = "not_opened" | "opened" | "held" | "deposit_paid" | "paid_in_full";
type State = "signed_off" | "promoted" | "ended" | "midway" | "invited";

type Row = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  branch: string | null;
  state: State;
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
  portalOpen: boolean;
  manual: boolean;
  eligible: boolean;
  messagedAt: string | null;
  decision: "send" | "remind" | "already";
  skipReason: string | null;
  lock: object | null;
  noticedAt: string | null;
};

type Summary = {
  activeTotal: number;
  onList: number;
  portalLocked: number;
  toSend: number;
  toRemind: number;
  messaged: number;
  excluded: Array<{ reason: string; label: string; count: number }>;
};
type Auto = { enabled: boolean; lastRunAt: string | null; lastRunSummary: string | null };
type Payload = { rows: Row[]; counts: Record<Stage, number>; summary?: Summary; auto?: Auto };
type Preview = { name: string; title: string; message: string; html: string } | null;

const STAGE_TEXT: Record<Stage, string> = {
  not_opened: "Hasn't opened it yet",
  opened: "Opened the journey",
  held: "Details in — holding a seat",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
};

const TONE: Record<Stage, string> = {
  not_opened: "bg-rose-500/15 text-rose-700",
  opened: "bg-amber-500/15 text-amber-700",
  held: "bg-sky-500/15 text-sky-700",
  deposit_paid: "bg-emerald-500/15 text-emerald-700",
  paid_in_full: "bg-emerald-600/20 text-emerald-800",
};

const STATE_LABEL: Record<State, string> = {
  signed_off: "Signed off",
  promoted: "Moved up — waiting for intake",
  ended: "Batch ended",
  midway: "A month in",
  invited: "Invited by the office",
};

const STAGES: Stage[] = ["not_opened", "opened", "held", "deposit_paid", "paid_in_full"];
const STATES: State[] = ["ended", "signed_off", "midway", "promoted", "invited"];

export default function NextLevelPipelinePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [stateFilter, setStateFilter] = useState<State | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [showPreview, setShowPreview] = useState(false);

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
    () =>
      (data?.rows ?? []).filter(
        (r) => (filter === "all" || r.stage === filter) && (stateFilter === "all" || r.state === stateFilter),
      ),
    [data, filter, stateFilter],
  );
  // Three groups, so the button always says what pressing it will really do.
  const toSend = rows.filter((r) => r.eligible && r.decision === "send");
  const toRemind = rows.filter((r) => r.eligible && r.decision === "remind");
  const messagedCount = rows.filter((r) => r.messagedAt).length;
  const sendable = toSend;

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/next-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Something went wrong");
    return json;
  }

  async function openPreview() {
    setBusy(true);
    setMessage("");
    try {
      const target = sendable[0] ?? rows[0];
      const json = await post({ action: "preview", studentId: target?.studentId });
      setPreview(json.preview ?? null);
      setShowPreview(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load the preview");
    } finally {
      setBusy(false);
    }
  }

  // Locked portals get their own message: where they stand, in their own figures.
  const lockedRows = rows.filter((r) => r.lock);
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const lockedNew = lockedRows.filter((r) => !r.noticedAt);
  const lockedAgain = lockedRows.filter((r) => r.noticedAt && Date.now() - Date.parse(r.noticedAt) >= WEEK_MS);

  async function openLockedPreview() {
    setBusy(true);
    setMessage("");
    try {
      const json = await post({ action: "previewLocked", studentId: (lockedNew[0] ?? lockedRows[0])?.studentId });
      setPreview(json.preview ?? null);
      setShowPreview(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load the preview");
    } finally {
      setBusy(false);
    }
  }

  async function sendLocked(ids: string[], includeAgain = false) {
    if (ids.length === 0) return;
    if (!window.confirm(`Send the status notice to ${ids.length} locked student${ids.length === 1 ? "" : "s"}? It goes out as a bell and an email (no SMS), once each.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const json = await post({ action: "sendLocked", studentIds: ids, includeAgain });
      setMessage(
        `Status notice sent to ${json.sent} student${json.sent === 1 ? "" : "s"}.` +
          (json.alreadyNoticed ? ` ${json.alreadyNoticed} had it recently — left alone.` : "") +
          (json.failed ? ` ${json.failed} failed.` : ""),
      );
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function setAuto(enabled: boolean) {
    setBusy(true);
    try {
      const json = await post({ action: "setAuto", enabled });
      setData((prev) => (prev ? { ...prev, auto: json.auto } : prev));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not change that");
    } finally {
      setBusy(false);
    }
  }

  async function send(ids: string[], includeReminders = false) {
    if (ids.length === 0) return;
    const what = includeReminders ? "a reminder" : "Becca's message";
    if (!window.confirm(`Send ${what} to ${ids.length} student${ids.length === 1 ? "" : "s"}? It goes out as a bell, a push and an email, once each.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const json = await post({ action: "send", studentIds: ids, includeReminders });
      setMessage(
        `Sent to ${json.sent} student${json.sent === 1 ? "" : "s"}.` +
          (json.alreadyMessaged ? ` ${json.alreadyMessaged} had already been messaged — left alone.` : "") +
          (json.skippedLocked ? ` ${json.skippedLocked} skipped — portal locked.` : "") +
          (json.skipped ? ` ${json.skipped} skipped — already answered.` : ""),
      );
      setSelected(new Set());
      load();
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

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
      active ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
    }`;

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]">
          <LevelUpIcon className="h-7 w-7 text-[var(--accent)]" />
          Next level
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          Becca&apos;s next-level message, already written from each student&apos;s own numbers. Read the preview, press
          send — the bell, the push and the email go out together, and the pop shows on their dashboard. Only students
          whose portal is open (paid at least the deposit) are messaged. Moving people up still happens on{" "}
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
                  <p className="mt-1 text-xs font-semibold text-[var(--muted)]">{STAGE_TEXT[st]}</p>
                </button>
              ))}
            </div>

            {data.summary && (
              <details className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
                <summary className="cursor-pointer font-semibold text-[var(--foreground)]">
                  Why only {data.summary.onList} of {data.summary.activeTotal} students are on this list
                </summary>
                <ul className="mt-3 space-y-1.5 text-[var(--muted)]">
                  {data.summary.excluded.map((e) => (
                    <li key={e.reason}>
                      <strong className="text-[var(--foreground)]">{e.count}</strong> — {e.label}
                    </li>
                  ))}
                  <li>
                    <strong className="text-[var(--foreground)]">{data.summary.portalLocked}</strong> of the {data.summary.onList} on
                    the list have a locked portal, so they are listed but never messaged.
                  </li>
                </ul>
              </details>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Who:</span>
              <button onClick={() => setStateFilter("all")} className={chip(stateFilter === "all")}>
                Everyone
              </button>
              {STATES.map((st) => (
                <button key={st} onClick={() => setStateFilter(stateFilter === st ? "all" : st)} className={chip(stateFilter === st)}>
                  {STATE_LABEL[st]}
                </button>
              ))}
            </div>

            {data.auto && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--foreground)]">
                    Send automatically — {data.auto.enabled ? "ON" : "OFF"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    When on, every morning anyone new who becomes eligible (portal open, never messaged) gets Becca&apos;s message by
                    bell, push and email — nobody twice, and you press nothing.
                    {data.auto.lastRunSummary ? ` Last run: ${data.auto.lastRunSummary}` : ""}
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => setAuto(!data.auto?.enabled)}
                  aria-pressed={data.auto.enabled}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${data.auto.enabled ? "bg-emerald-500" : "bg-[var(--border)]"}`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${data.auto.enabled ? "left-[22px]" : "left-0.5"}`}
                  />
                  <span className="sr-only">Toggle automatic sending</span>
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                disabled={busy || rows.length === 0}
                onClick={openPreview}
                className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
              >
                Preview the message
              </button>
              {toSend.length > 0 ? (
                <button
                  disabled={busy}
                  onClick={() => send(toSend.map((r) => r.studentId))}
                  className="rounded-full btn-glow px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  Send to {toSend.length} new student{toSend.length === 1 ? "" : "s"} — bell, push &amp; email
                </button>
              ) : (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-800">
                  ✓ Everyone reachable has been messaged{messagedCount > 0 ? ` (${messagedCount})` : ""}
                </span>
              )}
              {toRemind.length > 0 && (
                <button
                  disabled={busy}
                  onClick={() => send(toRemind.map((r) => r.studentId), true)}
                  className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
                >
                  Remind {toRemind.length} who haven&apos;t opened it (3+ days)
                </button>
              )}
              <button
                disabled={busy || selected.size === 0}
                onClick={() => send([...selected])}
                className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
              >
                Send to selected ({selected.size})
              </button>
              {message && <span className="text-sm font-semibold text-emerald-700">{message}</span>}
            </div>
            {lockedRows.length > 0 && (
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-sm font-bold text-[var(--foreground)]">
                  Locked portals ({lockedRows.length}) — these students can&apos;t be reached by the next-level message
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  They are skipped above on purpose. Send them a separate status update instead: why their portal is locked, the
                  exact amount that opens it again, and a link to pay — written from their own figures, by bell and email (no
                  SMS). No deadlines or threats, and anyone who got it in the last week is left alone.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    disabled={busy}
                    onClick={openLockedPreview}
                    className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
                  >
                    Preview the status notice
                  </button>
                  {lockedNew.length > 0 ? (
                    <button
                      disabled={busy}
                      onClick={() => sendLocked(lockedNew.map((r) => r.studentId))}
                      className="rounded-full btn-glow px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      Send status notice to {lockedNew.length} locked student{lockedNew.length === 1 ? "" : "s"}
                    </button>
                  ) : (
                    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-5 py-2 text-sm font-bold text-emerald-800">
                      ✓ Every locked student has been sent their status ({lockedRows.filter((r) => r.noticedAt).length})
                    </span>
                  )}
                  {lockedAgain.length > 0 && (
                    <button
                      disabled={busy}
                      onClick={() => sendLocked(lockedAgain.map((r) => r.studentId), true)}
                      className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
                    >
                      Send again to {lockedAgain.length} (a week or more since)
                    </button>
                  )}
                </div>
              </div>
            )}

            {showPreview && (
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {preview ? `Preview — as ${preview.name} would get it` : "Preview"}
                    </p>
                    {preview && (
                      <>
                        <p className="mt-1 text-sm font-bold text-[var(--foreground)]">{preview.title}</p>
                        <p className="text-sm text-[var(--muted)]">{preview.message}</p>
                      </>
                    )}
                  </div>
                  <button onClick={() => setShowPreview(false)} className="text-sm font-semibold text-[var(--muted)] underline">
                    Close
                  </button>
                </div>
                {preview ? (
                  <iframe
                    title="Email preview"
                    srcDoc={preview.html}
                    sandbox=""
                    className="mt-3 h-[560px] w-full rounded-xl border border-[var(--border)] bg-white"
                  />
                ) : (
                  <p className="mt-3 text-sm text-[var(--muted)]">Nobody on this list to preview yet.</p>
                )}
              </div>
            )}

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
                        Nobody here yet. Students appear when their batch ends, or a month into their level.
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
                          disabled={!r.eligible}
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
                        {!r.portalOpen && !r.manual && (
                          <p className="text-xs font-semibold text-rose-700">
                            Portal locked
                            {r.noticedAt
                              ? ` — status notice sent ${new Date(r.noticedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                              : " — no message yet"}
                          </p>
                        )}
                        {r.manual && <p className="text-xs font-semibold text-sky-700">Chosen by the office — messaged even if locked</p>}
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
                        {r.messagedAt && (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Messaged {new Date(r.messagedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                        )}
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
