"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * FINANCE → REMINDERS.
 *
 * The desk for chasing fees, in the order the office uses it:
 *   1. the three switches for the AUTOMATIC reminders (emails, notifications,
 *      Becca's pop-ups) — on or off at any time, no deploy;
 *   2. who owes, in the four groups the office actually phones — each with its
 *      list, its call sheet (CSV) and a mass reminder;
 *   3. the mass reminder itself: preview who it reaches and what it says, then
 *      send, with a progress bar.
 *
 * Every count, list, sheet and audience here comes from one rule
 * (lib/finance/receivables.ts → chaseCategoryOf), so the number on a card is the
 * number of rows in the list it links to and the number of lines in its sheet.
 */

type Category = "nothing" | "under_deposit" | "balance" | "legacy";

type Settings = {
  emails: boolean;
  notifications: boolean;
  becca: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

type Overview = {
  settings: Settings;
  chase: Record<Category, { students: number; owed: number; owedOnDeposit: number }>;
  chaseAll: { students: number; owed: number };
  onHold: number;
  awaiting: Record<Category, number>;
  recent: Array<{ day: string; students: number; lastAt: string }>;
  emailConfigured: boolean;
};

type Audience = {
  members: Array<{ studentId: string; name: string; category: Category; owed: number; priority: number }>;
  excluded: { awaitingBatch: number; recentlyReminded: number };
  byCategory: Record<Category, number>;
  totalOwed: number;
  sample: { name: string; category: Category; title: string; message: string } | null;
  chunkSize: number;
};

type SendTotals = { sent: number; pushed: number; emailsQueued: number; noLongerOwing: number; recentlyReminded: number; failed: number };

const GROUPS: Array<{ id: Category; focus: string; label: string; hint: string }> = [
  { id: "nothing", focus: "chase_nothing", label: "Registered, paid nothing", hint: "Account shows ₦0 — classes have not opened" },
  { id: "under_deposit", focus: "chase_under_deposit", label: "Paid, but under the deposit", hint: "Some money in, not enough to open classes" },
  { id: "balance", focus: "chase_balance", label: "Classes open, balance owing", hint: "Deposit paid, the rest of the tuition is owed" },
  { id: "legacy", focus: "chase_legacy", label: "Old balance only", hint: "Owes on an earlier level; current level is clear" },
];

/**
 * WHO THIS DIALOG REACHES — not just a category any more.
 *
 * `filters` are the same `RosterFilters` keys the Students roster, its call
 * sheet and the audience endpoint already share (see student-roster-query.ts
 * and fee-chase-send.ts). `label` is what the dialog's "To ___" line says.
 */
type SendScope = { filters: Record<string, string>; label: string };

/** Mirrors FOCUS_PRESETS' `chase_*` labels in lib/finance/receivables.ts. */
const FOCUS_LABELS: Record<string, string> = {
  chase_all: "everyone who owes",
  chase_nothing: GROUPS[0].label.toLowerCase(),
  chase_under_deposit: GROUPS[1].label.toLowerCase(),
  chase_balance: GROUPS[2].label.toLowerCase(),
  chase_legacy: GROUPS[3].label.toLowerCase(),
  chase_on_hold: "access on hold",
};

/** Readable names for the other roster filters a "Send a reminder…" link can carry over. */
const FILTER_LABELS: Record<string, string> = {
  branchId: "Branch",
  level: "Level",
  batch: "Batch",
  classType: "Class type",
  sessionSlot: "Session",
  status: "Status",
  paymentStatus: "Payment status",
  tutorId: "Tutor",
  search: "Search",
  agingBucket: "Aging",
  tag: "Tag",
  year: "Year",
  ids: "Selected students",
};

/** The known `RosterFilters` keys — same set the audience endpoint accepts. */
const FILTER_KEYS = [
  "branchId",
  "level",
  "batch",
  "classType",
  "sessionSlot",
  "status",
  "paymentStatus",
  "tutorId",
  "search",
  "focus",
  "agingBucket",
  "ids",
  "tag",
  "year",
] as const;

/** `chase_nothing` → `"nothing"`, etc. Anything else (chase_all, chase_on_hold, no focus) is null — the filters alone carry the narrowing. */
function categoryFromFocus(focus: string | undefined): Category | null {
  const hit = GROUPS.find((g) => g.focus === focus);
  return hit ? hit.id : null;
}

/** One short line describing a filtered scope, for the banner and the dialog's "To ___". */
function describeFilters(filters: Record<string, string>): string {
  const parts: string[] = [];
  if (filters.focus) parts.push(FOCUS_LABELS[filters.focus] ?? filters.focus);
  for (const key of FILTER_KEYS) {
    if (key === "focus" || !filters[key]) continue;
    const value = key === "ids" ? `${filters[key].split(",").filter(Boolean).length} students` : filters[key];
    parts.push(`${FILTER_LABELS[key] ?? key}: ${value}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "everyone who owes";
}

const SWITCHES: Array<{ key: "emails" | "notifications" | "becca"; title: string; body: string }> = [
  {
    key: "emails",
    title: "Emails",
    body: "The 7, 14 and 30-day emails to part-payers, and the “access paused” email.",
  },
  {
    key: "notifications",
    title: "Notifications",
    body: "Bell and phone-push warnings — for those who never paid the deposit, before a part-payer's access pauses, and the October seat reminders.",
  },
  {
    key: "becca",
    title: "Becca pop-ups",
    body: "Becca's daily card on the dashboard, and the “your seat is waiting” card a locked-out student sees.",
  },
];

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

function niceDay(day: string) {
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
}

export default function FeeRemindersPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  /** `null` = closed; otherwise who the open dialog would reach. */
  const [sending, setSending] = useState<SendScope | null>(null);

  /**
   * CARRIED OVER FROM THE STUDENTS ROSTER.
   *
   * "Send a reminder…" on /admin/students links here with the exact filters
   * that view was narrowed to (batch, the chase chip, branch, search, …) —
   * see `reminderUrl()` there. Landing on the generic four-category panel and
   * dropping that narrowing silently is the bug this fixes: a reminder aimed
   * at "October, paid nothing" must not reach November's paid-nothing too.
   */
  const searchParams = useSearchParams();
  const incomingFilters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key);
    if (value) incomingFilters[key] = value;
  }
  const hasIncomingFilters = Object.keys(incomingFilters).length > 0;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fee-reminders", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not load reminders");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reminders");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function flip(key: "emails" | "notifications" | "becca", value: boolean) {
    if (!data) return;
    setSavingKey(key);
    // Optimistic, then settled by the server's answer.
    setData({ ...data, settings: { ...data.settings, [key]: value } });
    try {
      const res = await fetch("/api/admin/fee-reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Could not save");
      setData((current) => (current ? { ...current, settings: json.settings } : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      await load();
    } finally {
      setSavingKey(null);
    }
  }

  if (error && !data) {
    return <p className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;
  }
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading reminders…</p>;

  const allOn = data.settings.emails && data.settings.notifications && data.settings.becca;
  const allOff = !data.settings.emails && !data.settings.notifications && !data.settings.becca;

  return (
    <div className="space-y-8">
      {error && <p className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}

      {/* ------------------------------------------------ automatic reminders */}
      <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Automatic reminders</p>
            <h2 className="mt-1 text-xl font-bold">
              {allOn ? "All on" : allOff ? "All paused" : "Some paused"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              These go out by themselves, every morning around 7:00 (Lagos), to students who owe. Switch any of them
              off or on at any time — it takes effect at the next run. Sending a reminder by hand (below) always works,
              whatever these say.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={allOn || savingKey !== null}
              onClick={async () => {
                for (const s of SWITCHES) if (!data.settings[s.key]) await flip(s.key, true);
              }}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold disabled:opacity-40"
            >
              Turn all on
            </button>
            <button
              type="button"
              disabled={allOff || savingKey !== null}
              onClick={async () => {
                for (const s of SWITCHES) if (data.settings[s.key]) await flip(s.key, false);
              }}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold disabled:opacity-40"
            >
              Pause all
            </button>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-[var(--border)]">
          {SWITCHES.map((s) => {
            const on = data.settings[s.key];
            return (
              <li key={s.key} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">{s.body}</p>
                  {s.key === "emails" && !data.emailConfigured && (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      Email delivery is not configured on this server — emails would queue but not send.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${s.title} reminders`}
                  disabled={savingKey === s.key}
                  onClick={() => void flip(s.key, !on)}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-[var(--border)]"} disabled:opacity-60`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        {data.settings.updatedAt && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Last changed {new Date(data.settings.updatedAt).toLocaleString("en-NG")}
            {data.settings.updatedByName ? ` by ${data.settings.updatedByName}` : ""}.
          </p>
        )}
      </section>

      {/* ---------------------------------------- carried over from Students */}
      {hasIncomingFilters && (
        <section
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-5 py-4"
        >
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Filtered from Students</p>
            <p className="mt-1 text-sm text-[var(--foreground)]">
              You came here filtered to <span className="font-semibold">{describeFilters(incomingFilters)}</span>. The
              mass reminder below only reaches that same group — the four cards further down still cover everyone.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/admin/finance?tab=reminders"
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            >
              Clear filter
            </Link>
            <button
              type="button"
              onClick={() => setSending({ filters: incomingFilters, label: describeFilters(incomingFilters) })}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            >
              Send to this filtered list…
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- who owes */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Who owes</p>
            <h2 className="mt-1 text-xl font-bold">
              {data.chaseAll.students} student{data.chaseAll.students === 1 ? "" : "s"} · {naira(data.chaseAll.owed)} outstanding
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Active students only. {data.onHold > 0 ? `${data.onHold} have their access on hold. ` : ""}
              Each list shows their phone number under their name.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/students?focus=chase_all"
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            >
              View everyone
            </Link>
            <a
              href="/api/admin/students/export?focus=chase_all&layout=chase"
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            >
              Download call sheet
            </a>
            <button
              type="button"
              disabled={data.chaseAll.students === 0}
              onClick={() => setSending({ filters: { focus: "chase_all" }, label: FOCUS_LABELS.chase_all })}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Send reminder to everyone
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {GROUPS.map((g) => {
            const row = data.chase[g.id];
            const waiting = data.awaiting[g.id] ?? 0;
            return (
              <div key={g.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <p className="font-semibold">{g.label}</p>
                <p className="text-xs text-[var(--muted)]">{g.hint}</p>
                <p className="mt-3 text-3xl font-bold">{row.students}</p>
                <p className="text-sm text-[var(--muted)]">
                  {naira(row.owed)} owed
                  {g.id === "nothing" || g.id === "under_deposit" ? ` · ${naira(row.owedOnDeposit)} short of the deposit` : ""}
                  {waiting > 0 ? ` · ${waiting} waiting for a future intake` : ""}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/admin/students?focus=${g.focus}`}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                  >
                    View list
                  </Link>
                  <a
                    href={`/api/admin/students/export?focus=${g.focus}&layout=chase`}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                  >
                    Call sheet
                  </a>
                  <button
                    type="button"
                    disabled={row.students === 0}
                    onClick={() => setSending({ filters: { focus: g.focus }, label: g.label.toLowerCase() })}
                    className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Send reminder
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------- recent sends */}
      {data.recent.length > 0 && (
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Recent mass reminders</p>
          <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
            {data.recent.map((r) => (
              <li key={r.day} className="flex justify-between py-2">
                <span>{niceDay(r.day)}</span>
                <span className="text-[var(--muted)]">
                  {r.students} student{r.students === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sending && (
        <SendDialog
          scope={sending}
          emailConfigured={data.emailConfigured}
          onClose={() => {
            setSending(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SendDialog({
  scope,
  emailConfigured,
  onClose,
}: {
  scope: SendScope;
  emailConfigured: boolean;
  onClose: () => void;
}) {
  const { filters, label } = scope;
  const [email, setEmail] = useState(emailConfigured);
  const [includeAwaiting, setIncludeAwaiting] = useState(false);
  const [skipRecent, setSkipRecent] = useState(true);
  const [note, setNote] = useState("");
  const [audience, setAudience] = useState<Audience | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"review" | "sending" | "done">("review");
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<SendTotals | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  /** How many this scope would add if "include waiting for a future intake" were ticked — learned from the first (unticked) audience fetch and held steady after that, so the checkbox doesn't vanish once checked. */
  const [awaitingBaseline, setAwaitingBaseline] = useState<number | null>(null);
  const cancelled = useRef(false);

  const category = categoryFromFocus(filters.focus);

  useEffect(() => {
    let alive = true;
    setAudience(null);
    setLoadError(null);
    fetch("/api/admin/fee-reminders/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "audience", filters, category, includeAwaitingBatch: includeAwaiting, skipRecent }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Could not work out who this reaches");
        if (!alive) return;
        setAudience(json);
        if (!includeAwaiting) setAwaitingBaseline(json.excluded.awaitingBatch);
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Could not load the audience"));
    return () => {
      alive = false;
    };
  }, [filters, category, includeAwaiting, skipRecent]);

  async function start() {
    if (!audience || audience.members.length === 0) return;
    setPhase("sending");
    setSendError(null);
    cancelled.current = false;
    const running: SendTotals = { sent: 0, pushed: 0, emailsQueued: 0, noLongerOwing: 0, recentlyReminded: 0, failed: 0 };
    const ids = audience.members.map((m) => m.studentId);
    const size = audience.chunkSize || 40;

    for (let i = 0; i < ids.length; i += size) {
      if (cancelled.current) break;
      try {
        const res = await fetch("/api/admin/fee-reminders/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", studentIds: ids.slice(i, i + size), email, note, skipRecent, category }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "A batch failed");
        for (const key of Object.keys(running) as Array<keyof SendTotals>) running[key] += json[key] ?? 0;
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "A batch failed");
        break;
      }
      setProgress(Math.min(ids.length, i + size));
      setTotals({ ...running });
    }
    setTotals({ ...running });
    setPhase("done");
  }

  const count = audience?.members.length ?? 0;
  const scopeLabel = label;
  const awaitingInScope = awaitingBaseline ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <div>
          <h2 className="text-xl font-bold">Send a reminder</h2>
          <p className="text-sm text-[var(--muted)]">To {scopeLabel}. Each student is told their own balance.</p>
        </div>

        {phase === "review" && (
          <>
            {loadError && <p className="text-sm text-rose-700">{loadError}</p>}
            {!audience && !loadError && <p className="text-sm text-[var(--muted)]">Working out who this reaches…</p>}

            {audience && (
              <div className="rounded-2xl bg-[var(--surface-alt)] p-4">
                <p className="text-2xl font-bold">
                  {count} student{count === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-[var(--muted)]">{naira(audience.totalOwed)} outstanding between them</p>
                {(audience.excluded.awaitingBatch > 0 || audience.excluded.recentlyReminded > 0) && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
                    {audience.excluded.awaitingBatch > 0 && (
                      <li>{audience.excluded.awaitingBatch} left out — waiting for a future intake (they have their own reminders).</li>
                    )}
                    {audience.excluded.recentlyReminded > 0 && (
                      <li>{audience.excluded.recentlyReminded} left out — already reminded in the last 3 days.</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {audience?.sample && (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  What {audience.sample.name.split(" ")[0]} will see
                </p>
                <div className="mt-1 rounded-2xl border border-[var(--border)] p-3 text-sm">
                  <p className="font-semibold">{audience.sample.title}</p>
                  <p className="mt-1 whitespace-pre-line text-[var(--foreground-soft)]">
                    {audience.sample.message}
                    {note.trim() ? `\n\n${note.trim()}` : ""}
                  </p>
                </div>
              </div>
            )}

            <label className="block text-sm">
              <span className="font-semibold">Add a line of your own (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={400}
                rows={2}
                placeholder="e.g. Come to the office if you would like to arrange a plan."
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <span className="text-xs text-[var(--muted)]">No amounts here — each student&apos;s own balance is filled in for them.</span>
            </label>

            <div className="space-y-2 text-sm">
              <p className="text-xs text-[var(--muted)]">
                Every reminder rings the student&apos;s bell and buzzes their phone if they have notifications on.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={email} disabled={!emailConfigured} onChange={(e) => setEmail(e.target.checked)} />
                Also email it{!emailConfigured ? " (email is not configured on this server)" : ""}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={skipRecent} onChange={(e) => setSkipRecent(e.target.checked)} />
                Skip anyone already reminded in the last 3 days
              </label>
              {awaitingInScope > 0 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeAwaiting} onChange={(e) => setIncludeAwaiting(e.target.checked)} />
                  Include the {awaitingInScope} waiting for a future intake
                </label>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold">
                Cancel
              </button>
              <button
                type="button"
                disabled={count === 0}
                onClick={() => void start()}
                className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Send to {count}
              </button>
            </div>
          </>
        )}

        {phase === "sending" && (
          <div className="space-y-3">
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${count ? Math.round((progress / count) * 100) : 0}%` }}
              />
            </div>
            <p className="text-sm text-[var(--muted)]">
              Sending… {progress} of {count}. Keep this window open until it finishes.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  cancelled.current = true;
                }}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"
              >
                Stop after this batch
              </button>
            </div>
          </div>
        )}

        {phase === "done" && totals && (
          <div className="space-y-3">
            <p className="text-lg font-bold">
              {totals.sent} reminder{totals.sent === 1 ? "" : "s"} sent
            </p>
            <ul className="space-y-0.5 text-sm text-[var(--muted)]">
              <li>{totals.pushed} phone push{totals.pushed === 1 ? "" : "es"} delivered.</li>
              {email && <li>{totals.emailsQueued} email{totals.emailsQueued === 1 ? "" : "s"} sent or queued.</li>}
              {totals.noLongerOwing > 0 && <li>{totals.noLongerOwing} skipped — they paid while you were reviewing.</li>}
              {totals.recentlyReminded > 0 && <li>{totals.recentlyReminded} skipped — already reminded recently.</li>}
              {totals.failed > 0 && <li className="text-rose-700">{totals.failed} failed — press send again to retry those.</li>}
            </ul>
            {sendError && <p className="text-sm text-rose-700">Stopped early: {sendError}</p>}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
