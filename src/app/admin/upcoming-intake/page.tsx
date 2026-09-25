"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { CalendarIcon } from "@/components/icons";
import { SEAT_STATUS_LABEL, type SeatStatus } from "@/lib/batch-reservation";

/**
 * The upcoming-intake console.
 *
 * Learners placed in a batch that has not started sit behind a countdown on
 * their own portal (see BatchLockScreen). This page is the office's view of the
 * same people: how many are waiting, who has put money down and who has not,
 * what is still to collect — and the two levers: place more learners into the
 * intake by pasting their names, and have Becca nudge the ones who have not
 * held their seat yet.
 *
 * Everything here reads /api/admin/upcoming-intake, which uses the very same
 * loader as the student's waiting room and Becca's cron nudges, so the numbers
 * cannot disagree with what a learner sees.
 */

type Row = {
  studentId: string;
  name: string;
  email: string;
  phone: string;
  branch: string;
  level: string;
  sessionSlot: string;
  batch: string;
  batchLabel: string;
  startsOn: string;
  daysUntilStart: number;
  seat: SeatStatus;
  tuitionPaid: number;
  registrationPaid: boolean;
  tuitionFee: number;
  requiredDeposit: number;
  depositOutstanding: number;
  balanceOutstanding: number;
  firstPaidAt: string | null;
  seatNumber: number | null;
  lastNudgedAt: string | null;
  nudgeCount: number;
};

type Intake = {
  batchLabel: string;
  monthKey: string;
  startsOn: string;
  daysUntilStart: number;
  total: number;
  secured: number;
  bySeat: Record<SeatStatus, number>;
  tuitionCollected: number;
  balanceOutstanding: number;
};

type Candidate = {
  studentId: string;
  name: string;
  email: string;
  branch: string;
  level: string;
  currentBatch: string | null;
  alreadyInClass: boolean;
  score: number;
};

type MatchResult = { query: string; candidates: Candidate[] };

const SEAT_ORDER: SeatStatus[] = ["paid_in_full", "deposit_paid", "registration_only", "unpaid"];

const SEAT_STYLE: Record<SeatStatus, string> = {
  paid_in_full: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  deposit_paid: "bg-sky-50 text-sky-800 ring-sky-300",
  registration_only: "bg-amber-50 text-amber-800 ring-amber-300",
  unpaid: "bg-rose-50 text-rose-800 ring-rose-300",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function naira(value: number) {
  return `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

function dayOfMonth(iso: string) {
  return Number(
    new Date(iso).toLocaleDateString("en-CA", { day: "numeric", timeZone: "Africa/Lagos" }),
  );
}

function ordinal(day: number) {
  if (day % 10 === 1 && day !== 11) return "st";
  if (day % 10 === 2 && day !== 12) return "nd";
  if (day % 10 === 3 && day !== 13) return "rd";
  return "th";
}

function csvCell(value: string | number | null) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function UpcomingIntakePage() {
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<SeatStatus | "all">("all");
  const [activeIntake, setActiveIntake] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [names, setNames] = useState("");
  const [month, setMonth] = useState("October");
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const [editingStartDay, setEditingStartDay] = useState(false);
  const [startDayInput, setStartDayInput] = useState("1");
  const [savingStartDay, setSavingStartDay] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/upcoming-intake", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load");
      setIntakes(json.intakes);
      setRows(json.rows);
      setActiveIntake((current) => current || json.intakes[0]?.batchLabel || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const intake = intakes.find((i) => i.batchLabel === activeIntake) ?? intakes[0] ?? null;
  const inIntake = useMemo(() => rows.filter((row) => !intake || row.batchLabel === intake.batchLabel), [rows, intake]);
  const visible = useMemo(() => inIntake.filter((row) => filter === "all" || row.seat === filter), [inIntake, filter]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/upcoming-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "That did not work");
    return json;
  }

  async function nudge() {
    setBusy(true);
    setMsg("");
    try {
      const result = await post({ action: "nudge", studentIds: [...selected] });
      setMsg(`Becca messaged ${result.sent} learner${result.sent === 1 ? "" : "s"}${result.skipped ? ` (${result.skipped} skipped — already paid, or nudged today)` : ""}.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  async function findNames() {
    const list = names.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const result = await post({ action: "match", names: list });
      setMatches(result.results);
      // Pre-select only the unambiguous ones: a single candidate that matches
      // every word. Anything else is the office's call.
      const auto: Record<string, string> = {};
      for (const r of result.results as MatchResult[]) {
        if (r.candidates.length === 1 && r.candidates[0].score >= 0.9) auto[r.query] = r.candidates[0].studentId;
      }
      setPicked(auto);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  async function place() {
    const ids = Object.values(picked).filter(Boolean);
    if (ids.length === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const result = await post({ action: "assign", studentIds: ids, month });
      setMsg(
        `${result.locked} learner${result.locked === 1 ? " is" : "s are"} now waiting for ${result.month}.` +
          (result.notLocked.length ? ` Not locked (already in class, or that month has begun): ${result.notLocked.join(", ")}.` : ""),
      );
      setMatches(null);
      setNames("");
      setPicked({});
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  async function saveStartDay() {
    if (!intake) return;
    const day = Number(startDayInput);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setMsg("Give a day between 1 and 28.");
      return;
    }
    setSavingStartDay(true);
    setMsg("");
    try {
      await post({ action: "setStartDay", monthKey: intake.monthKey, day: day === 1 ? null : day });
      setMsg(
        day === 1
          ? `${intake.batchLabel} now opens on the 1st, same as every other intake.`
          : `${intake.batchLabel} now opens on the ${day}${ordinal(day)} — live everywhere the countdown shows.`,
      );
      setEditingStartDay(false);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change the opening day");
    } finally {
      setSavingStartDay(false);
    }
  }

  function exportCsv() {
    const header = ["Name", "Email", "Phone", "Branch", "Level", "Session", "Intake", "Seat status", "Seat #", "Tuition paid", "Registration fee paid", "Deposit still due", "Balance still owed", "First payment", "Last nudged"];
    const lines = inIntake.map((r) =>
      [r.name, r.email, r.phone, r.branch, r.level, r.sessionSlot, r.batchLabel, SEAT_STATUS_LABEL[r.seat], r.seatNumber, r.tuitionPaid, r.registrationPaid ? "yes" : "no", r.depositOutstanding, r.balanceOutstanding, r.firstPaidAt?.slice(0, 10) ?? "", r.lastNudgedAt?.slice(0, 10) ?? ""]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `upcoming-intake-${(intake?.batchLabel ?? "all").replace(/\s+/g, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const selectedNeedingPayment = [...selected].filter((id) => {
    const row = rows.find((r) => r.studentId === id);
    return row && (row.seat === "unpaid" || row.seat === "registration_only");
  });

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <CalendarIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Upcoming intake</h1>
          </div>
          <p className="text-[var(--muted)]">
            Learners placed in a batch that has not started. Their portal is a countdown until the first day — paid in
            full, part-paid, registration only or nothing — and Becca encourages the unpaid ones to hold their seat.
            Move people between months on{" "}
            <Link href="/admin/cohorts" className="text-[var(--accent)] underline">
              Cohorts
            </Link>
            .
          </p>
        </div>

        {msg && <div className="rounded-lg bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--foreground)] shadow-sm">{msg}</div>}
        {error && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}
        {loading && <p className="text-[var(--muted)]">Loading…</p>}

        {!loading && !error && intakes.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            Nobody is waiting for a future intake right now. Use <strong className="text-[var(--foreground)]">Place learners</strong> below
            to put learners into one — their portal will wait behind a countdown automatically.
          </div>
        )}

        {intakes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {intakes.map((i) => (
              <button
                key={i.batchLabel}
                onClick={() => {
                  setActiveIntake(i.batchLabel);
                  setSelected(new Set());
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                  intake?.batchLabel === i.batchLabel
                    ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                    : "bg-[var(--surface)] text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"
                }`}
              >
                {i.batchLabel} · {i.total}
              </button>
            ))}
          </div>
        )}

        {intake && (
          <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">{intake.batchLabel} intake</p>
                <p className="text-2xl font-bold text-[var(--foreground)]">
                  Opens in {intake.daysUntilStart} day{intake.daysUntilStart === 1 ? "" : "s"}
                </p>
                {editingStartDay ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--muted)]">{intake.batchLabel.split(" ")[0]} opens on the</span>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={startDayInput}
                      onChange={(e) => setStartDayInput(e.target.value)}
                      className="w-16 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--foreground)]"
                      autoFocus
                    />
                    <button
                      disabled={savingStartDay}
                      onClick={saveStartDay}
                      className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      disabled={savingStartDay}
                      onClick={() => setEditingStartDay(false)}
                      className="text-xs text-[var(--muted)] underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setStartDayInput(String(dayOfMonth(intake.startsOn)));
                      setEditingStartDay(true);
                    }}
                    className="mt-1 inline-flex flex-wrap items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {when(intake.startsOn)}
                    <span className="text-xs font-semibold text-[var(--accent)] underline">Change opening day</span>
                  </button>
                )}
              </div>
              <button onClick={exportCsv} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--background)]">
                Download CSV
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Waiting" value={String(intake.total)} />
              {SEAT_ORDER.map((seat) => (
                <Stat key={seat} label={SEAT_STATUS_LABEL[seat]} value={String(intake.bySeat[seat])} tone={seat} />
              ))}
              <Stat label="Tuition collected" value={naira(intake.tuitionCollected)} />
            </div>

            {intake.total > 0 && (
              <div className="flex h-3 overflow-hidden rounded-full bg-[var(--background)]" aria-hidden>
                {SEAT_ORDER.map((seat) => (
                  <div
                    key={seat}
                    style={{ width: `${(intake.bySeat[seat] / intake.total) * 100}%` }}
                    className={{ paid_in_full: "bg-emerald-500", deposit_paid: "bg-sky-500", registration_only: "bg-amber-400", unpaid: "bg-rose-400" }[seat]}
                  />
                ))}
              </div>
            )}
            <p className="text-sm text-[var(--muted)]">
              Still to collect on these seats: <strong className="text-[var(--foreground)]">{naira(intake.balanceOutstanding)}</strong>
            </p>
          </section>
        )}

        {intake && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--muted)]">Show</span>
              {(["all", ...SEAT_ORDER] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-1 font-medium ring-1 ring-inset transition ${
                    filter === value
                      ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                      : "bg-[var(--surface)] text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {value === "all" ? `Everyone (${inIntake.length})` : `${SEAT_STATUS_LABEL[value]} (${inIntake.filter((r) => r.seat === value).length})`}
                </button>
              ))}
            </div>

            {selected.size > 0 && (
              <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--foreground)] px-4 py-3 text-sm text-[var(--background)] shadow-lg">
                <span>
                  {selected.size} selected · {selectedNeedingPayment.length} still to pay
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set())} className="rounded-full px-3 py-1.5 font-semibold opacity-80 hover:opacity-100">
                    Clear
                  </button>
                  <button
                    disabled={busy || selectedNeedingPayment.length === 0}
                    onClick={nudge}
                    className="rounded-full bg-[#FF6600] px-4 py-1.5 font-semibold text-white disabled:opacity-50"
                  >
                    Nudge {selectedNeedingPayment.length} via Becca
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select everyone shown"
                        checked={visible.length > 0 && visible.every((r) => selected.has(r.studentId))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((r) => r.studentId)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-3">Learner</th>
                    <th className="px-3 py-3">Class</th>
                    <th className="px-3 py-3">Seat</th>
                    <th className="px-3 py-3 text-right">Paid</th>
                    <th className="px-3 py-3 text-right">Still owed</th>
                    <th className="px-3 py-3">Becca</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {visible.map((row) => (
                    <tr key={row.studentId} className="align-top">
                      <td className="px-3 py-3">
                        <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.studentId)} onChange={() => toggle(row.studentId)} />
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/admin/students/${row.studentId}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
                          {row.name}
                        </Link>
                        <p className="text-xs text-[var(--muted)]">{row.email}</p>
                        {row.phone && <p className="text-xs text-[var(--muted)]">{row.phone}</p>}
                      </td>
                      <td className="px-3 py-3 text-[var(--muted)]">
                        {row.branch}
                        <br />
                        {row.level} · {row.sessionSlot}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${SEAT_STYLE[row.seat]}`}>
                          {SEAT_STATUS_LABEL[row.seat]}
                        </span>
                        {row.seatNumber && <p className="mt-1 text-xs text-[var(--muted)]">Seat #{row.seatNumber}</p>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {naira(row.tuitionPaid)}
                        {row.registrationPaid && <p className="text-xs text-[var(--muted)]">+ reg. fee</p>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {naira(row.balanceOutstanding)}
                        {row.depositOutstanding > 0 && <p className="text-xs text-amber-700">{naira(row.depositOutstanding)} to hold seat</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--muted)]">
                        {row.lastNudgedAt ? `${row.nudgeCount}× · last ${when(row.lastNudgedAt)}` : "Not yet"}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-[var(--muted)]">
                        Nobody matches that filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--foreground)]">Place learners into an intake</h2>
          <p className="text-sm text-[var(--muted)]">
            Paste names, one per line, in any order. Each is matched to a learner already on the LMS; nothing changes until you
            confirm. Their portal then waits behind the countdown on its own.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <textarea
              value={names}
              onChange={(e) => setNames(e.target.value)}
              rows={5}
              placeholder={"Adaeze Okafor\nTunde Bello"}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="intake-month">
                Intake month
              </label>
              <select
                id="intake-month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
              >
                {MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button
                disabled={busy || !names.trim()}
                onClick={findNames}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Find these learners
              </button>
            </div>
          </div>

          {matches && (
            <div className="space-y-3 pt-2">
              {matches.map((result) => (
                <div key={result.query} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{result.query}</p>
                  {result.candidates.length === 0 ? (
                    <p className="mt-1 text-sm text-rose-700">Not found on the LMS — they need to be registered first.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {result.candidates.map((c) => (
                        <label key={c.studentId} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name={`match-${result.query}`}
                            checked={picked[result.query] === c.studentId}
                            onChange={() => setPicked((current) => ({ ...current, [result.query]: c.studentId }))}
                            className="mt-1"
                          />
                          <span className="text-[var(--foreground)]">
                            {c.name} <span className="text-[var(--muted)]">· {c.email} · {c.branch} · {c.level} · batch {c.currentBatch ?? "none"}</span>
                            {c.alreadyInClass && <span className="ml-1 font-semibold text-amber-700">(already in class — will not lock)</span>}
                          </span>
                        </label>
                      ))}
                      {picked[result.query] && (
                        <button
                          onClick={() =>
                            setPicked((current) => {
                              const next = { ...current };
                              delete next[result.query];
                              return next;
                            })
                          }
                          className="text-xs text-[var(--muted)] underline"
                        >
                          Skip this one
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button
                disabled={busy || Object.values(picked).length === 0}
                onClick={place}
                className="rounded-full bg-[#FF6600] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Place {Object.values(picked).length} in {month}
              </button>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: SeatStatus }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ? "" : "text-[var(--foreground)]"}`}>
        {tone ? <span className={`rounded-full px-2 py-0.5 text-lg ring-1 ring-inset ${SEAT_STYLE[tone]}`}>{value}</span> : value}
      </p>
    </div>
  );
}
