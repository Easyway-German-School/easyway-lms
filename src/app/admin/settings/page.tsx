"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { SlidersIcon } from "@/components/icons";
import {
  LEVELS,
  SESSION_SLOTS as SESSIONS,
  MODE_SLOTS as MODES,
  MODE_LABELS,
  slotTitle,
  defaultSessionSettings,
  type SessionSettings as Settings,
  type SessionSlot,
  type ModeSlot,
} from "@/lib/school-settings";
import { MONTH_NAMES } from "@/lib/batch";
import { defaultCurrentIntake, type CurrentIntake } from "@/lib/intake";
import { emptySchedulePatternSettings, type SchedulePatternSettings, type SchedulePatternGrid } from "@/lib/schedule-pattern";
import { defaultSessionTimes, type SessionTimes } from "@/lib/session-times";

type MovePreview = { level: string; mode: ModeSlot; from: string; to: string; count: number };
type StrandPreview = { level: string; mode: ModeSlot; slot: string; count: number };
type TutorWarning = { name: string; detail: string };

type ImpactResponse = {
  affected: number;
  moves: MovePreview[];
  stranded: StrandPreview[];
  tutorWarnings: TutorWarning[];
};

const modeWord = (m: ModeSlot) => (m === "physical" ? "on campus" : m);

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => defaultSessionSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingImpact, setPendingImpact] = useState<ImpactResponse | null>(null);

  // The school's current intake — the month a new student joins by default
  // when the sign-up form, the Add-student form or the CSV import did not
  // carry one. See lib/intake.ts.
  const [intake, setIntake] = useState<CurrentIntake>(() => defaultCurrentIntake());
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeMsg, setIntakeMsg] = useState("");

  const [pattern, setPattern] = useState<SchedulePatternSettings>(() => emptySchedulePatternSettings());
  const [patternSaving, setPatternSaving] = useState(false);
  const [patternMsg, setPatternMsg] = useState("");

  const [sessionTimes, setSessionTimes] = useState<SessionTimes>(() => defaultSessionTimes());
  const [timesSaving, setTimesSaving] = useState(false);
  const [timesMsg, setTimesMsg] = useState("");

  useEffect(() => {
    loadSettings();
    loadIntake();
    loadPattern();
    loadSessionTimes();
  }, []);

  async function loadSessionTimes() {
    try {
      const res = await fetch("/api/admin/settings/session-times", { cache: "no-store" });
      if (res.ok) setSessionTimes(await res.json());
    } catch (error) {
      console.error("Failed to load session times:", error);
    }
  }

  async function saveSessionTimes() {
    setTimesSaving(true);
    setTimesMsg("");
    try {
      const res = await fetch("/api/admin/settings/session-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionTimes),
      });
      const data = await res.json();
      if (res.ok) {
        setTimesMsg("Saved. Signup and the hybrid-combo prompt now quote these hours.");
        setTimeout(() => setTimesMsg(""), 4000);
      } else {
        setTimesMsg(data.error || "Failed to save session times");
      }
    } catch (error) {
      console.error("Failed to save session times:", error);
      setTimesMsg("Failed to save session times");
    } finally {
      setTimesSaving(false);
    }
  }

  async function loadPattern() {
    try {
      const res = await fetch("/api/admin/settings/schedule-pattern", { cache: "no-store" });
      if (res.ok) setPattern(await res.json());
    } catch (error) {
      console.error("Failed to load the weekly pattern:", error);
    }
  }

  async function savePattern() {
    setPatternSaving(true);
    setPatternMsg("");
    try {
      const res = await fetch("/api/admin/settings/schedule-pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pattern),
      });
      const data = await res.json();
      if (res.ok) {
        setPatternMsg("Saved. New calendar days follow this pattern from here.");
        setTimeout(() => setPatternMsg(""), 4000);
      } else {
        setPatternMsg(data.error || "Failed to save the weekly pattern");
      }
    } catch (error) {
      console.error("Failed to save the weekly pattern:", error);
      setPatternMsg("Failed to save the weekly pattern");
    } finally {
      setPatternSaving(false);
    }
  }

  /** Mon → Sun for display; the stored day numbers stay JS's 0=Sun convention. */
  const PATTERN_WEEKDAYS: { day: number; label: string }[] = [
    { day: 1, label: "Mon" },
    { day: 2, label: "Tue" },
    { day: 3, label: "Wed" },
    { day: 4, label: "Thu" },
    { day: 5, label: "Fri" },
    { day: 6, label: "Sat" },
    { day: 0, label: "Sun" },
  ];

  function gridFor(level: string): SchedulePatternGrid {
    return pattern.levels.find((r) => r.level === level)?.grid ?? {};
  }

  function cellDays(level: string, slot: SessionSlot): number[] | null {
    return gridFor(level)[slot] ?? null;
  }

  function defaultStartingDays(slot: SessionSlot): number[] {
    return slot === "weekend" ? [6] : [1, 5, 6];
  }

  /** Immutable, keyed by level then slot. An empty day list reverts the cell to Auto. */
  function setCellDays(level: string, slot: SessionSlot, days: number[] | null) {
    setPattern((prev) => {
      const rows = prev.levels.some((r) => r.level === level)
        ? prev.levels
        : [...prev.levels, { level, grid: {} }];
      return {
        levels: rows.map((row) => {
          if (row.level !== level) return row;
          const grid = { ...row.grid };
          if (!days || days.length === 0) delete grid[slot];
          else grid[slot] = days;
          return { ...row, grid };
        }),
      };
    });
  }

  function toggleCustom(level: string, slot: SessionSlot, on: boolean) {
    setCellDays(level, slot, on ? defaultStartingDays(slot) : null);
  }

  function toggleDay(level: string, slot: SessionSlot, day: number) {
    const current = cellDays(level, slot) ?? defaultStartingDays(slot);
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    setCellDays(level, slot, next);
  }

  function autoHint(slot: SessionSlot): string {
    return slot === "weekend" ? "Auto — Saturday" : "Auto — alternates by batch (Mon·Fri·Sat or Tue·Wed·Thu)";
  }

  async function loadIntake() {
    try {
      const res = await fetch("/api/admin/settings/intake", { cache: "no-store" });
      if (res.ok) setIntake(await res.json());
    } catch (error) {
      console.error("Failed to load current intake:", error);
    }
  }

  async function saveIntake() {
    setIntakeSaving(true);
    setIntakeMsg("");
    try {
      const res = await fetch("/api/admin/settings/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intake),
      });
      const data = await res.json();
      if (res.ok) {
        setIntakeMsg("Saved. New students without a batch will join this intake.");
        setTimeout(() => setIntakeMsg(""), 4000);
      } else {
        setIntakeMsg(data.error || "Failed to save the current intake");
      }
    } catch (error) {
      console.error("Failed to save current intake:", error);
      setIntakeMsg("Failed to save the current intake");
    } finally {
      setIntakeSaving(false);
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (res.ok) setSettings(await res.json());
    } catch (error) {
      console.error("Failed to load settings:", error);
      setMessage("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  /**
   *   phase "preview"  → ask what would move, write nothing
   *   phase "confirm"  → write the setting and move the students
   * A plain save with nobody affected goes straight through as a confirm.
   */
  async function submitSettings(phase: "preview" | "confirm") {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          ...(phase === "preview" ? { preview: true } : { confirm: true }),
        }),
      });
      const data = await res.json();

      if (phase === "preview") {
        if (!res.ok) {
          setMessage(data.error || "Failed to check the change");
          return;
        }
        if (data.affected > 0 || (data.tutorWarnings?.length ?? 0) > 0) {
          setPendingImpact(data as ImpactResponse);
        } else {
          await submitSettings("confirm");
        }
        return;
      }

      setPendingImpact(null);
      if (res.ok) {
        const moved = data.moved as number;
        setMessage(
          moved > 0
            ? `Settings saved. ${moved} student${moved === 1 ? "" : "s"} moved to a session that still runs.`
            : "Settings saved.",
        );
        setTimeout(() => setMessage(""), 5000);
      } else {
        setMessage(data.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  /** Immutable, keyed by level then slot then mode. */
  function toggleCell(level: string, slot: SessionSlot, mode: ModeSlot) {
    setSettings((prev) => ({
      sessions: prev.sessions.map((row) =>
        row.level !== level
          ? row
          : {
              ...row,
              grid: {
                ...row.grid,
                [slot]: { ...row.grid[slot], [mode]: !row.grid[slot][mode] },
              },
            },
      ),
    }));
  }

  /** Toggle a whole session row on/off for a level. */
  function toggleRow(level: string, slot: SessionSlot, on: boolean) {
    setSettings((prev) => ({
      sessions: prev.sessions.map((row) =>
        row.level !== level
          ? row
          : {
              ...row,
              grid: {
                ...row.grid,
                [slot]: { physical: on, hybrid: on, online: on },
              },
            },
      ),
    }));
  }

  if (loading) {
    return (
      <AdminShell>
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-[var(--muted)]">Loading settings...</p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <SlidersIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Settings</h1>
          </div>
          <p className="text-[var(--muted)]">Configure which sessions run — and in which mode — for each level</p>
        </div>

        {message && (
          <div
            className={`rounded-lg px-4 py-3 text-sm font-medium ${
              message.toLowerCase().includes("saved")
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}

        {/* Current intake */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Current intake</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            The month a new student is placed in when no batch was chosen — on the public
            sign-up form, the Add-student form, or a CSV import row with no batch column.
            It does not touch students who already have a batch.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--foreground)]">
              Month
              <select
                value={intake.month}
                onChange={(e) => setIntake((prev) => ({ ...prev, month: e.target.value }))}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-normal text-[var(--foreground)]"
              >
                {MONTH_NAMES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--foreground)]">
              Year
              <input
                type="number"
                value={intake.year}
                min={new Date().getFullYear() - 5}
                max={new Date().getFullYear() + 5}
                onChange={(e) => setIntake((prev) => ({ ...prev, year: Number(e.target.value) }))}
                className="w-28 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-normal text-[var(--foreground)]"
              />
            </label>
            <button
              onClick={saveIntake}
              disabled={intakeSaving}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {intakeSaving ? "Saving..." : "Save intake"}
            </button>
          </div>
          {intakeMsg && (
            <p className={`mt-3 text-sm font-medium ${intakeMsg.startsWith("Saved") ? "text-emerald-700" : "text-red-700"}`}>
              {intakeMsg}
            </p>
          )}
        </div>

        {/* Session clock times */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Session times</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            The clock hours quoted on the sign-up form and the hybrid-combo prompt — these change
            every batch, so they live here instead of in code. Purely a display string; it does not
            change which sessions run (see &quot;Sessions &amp; attendance&quot; below for that).
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">On campus</p>
              <div className="space-y-3">
                {(["morning", "afternoon", "evening", "weekend"] as const).map((slot) => (
                  <label key={slot} className="flex items-center gap-3 text-sm font-medium text-[var(--foreground)]">
                    <span className="w-24 shrink-0 capitalize">{slot}</span>
                    <input
                      type="text"
                      value={sessionTimes.physical[slot]}
                      onChange={(e) =>
                        setSessionTimes((prev) => ({ ...prev, physical: { ...prev.physical, [slot]: e.target.value } }))
                      }
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-normal text-[var(--foreground)]"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Online (WAT)</p>
              <div className="space-y-3">
                {(["morning", "evening"] as const).map((slot) => (
                  <label key={slot} className="flex items-center gap-3 text-sm font-medium text-[var(--foreground)]">
                    <span className="w-24 shrink-0 capitalize">{slot}</span>
                    <input
                      type="text"
                      value={sessionTimes.online[slot]}
                      onChange={(e) =>
                        setSessionTimes((prev) => ({ ...prev, online: { ...prev.online, [slot]: e.target.value } }))
                      }
                      className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-normal text-[var(--foreground)]"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={saveSessionTimes}
            disabled={timesSaving}
            className="mt-6 rounded-lg bg-[var(--accent)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {timesSaving ? "Saving..." : "Save session times"}
          </button>
          {timesMsg && (
            <p className={`mt-3 text-sm font-medium ${timesMsg.startsWith("Saved") ? "text-emerald-700" : "text-red-700"}`}>
              {timesMsg}
            </p>
          )}
        </div>

        {/* Session × mode grid */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Sessions &amp; attendance</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            For each level, tick the ways each session actually runs. Unticking a cell removes
            it from student registration and hides its community room. Students already in it
            move to the nearest session that still runs their mode — an online morning student
            goes to online afternoon, not onto a campus — and are told. If a mode has no
            session left, those students are listed for the office instead. Re-enabling a cell
            later does not bring anyone back automatically.
          </p>

          <div className="space-y-8">
            {LEVELS.map((level) => {
              const config = settings.sessions.find((s) => s.level === level);
              if (!config) return null;

              return (
                <div key={level} className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-6">
                  <h3 className="mb-3 text-base font-bold text-[var(--foreground)]">{level}</h3>
                  <table className="w-full min-w-[420px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        <th className="py-2 pr-4 font-semibold">Session</th>
                        {MODES.map((mode) => (
                          <th key={mode} className="px-3 py-2 text-center font-semibold">{MODE_LABELS[mode]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SESSIONS.map((slot) => {
                        const rowAllOn = MODES.every((m) => config.grid[slot][m]);
                        return (
                          <tr key={slot} className="border-t border-[var(--border)]">
                            <td className="py-2 pr-4">
                              <button
                                type="button"
                                onClick={() => toggleRow(level, slot, !rowAllOn)}
                                className="font-medium text-[var(--foreground)] hover:text-[var(--accent)]"
                                title={rowAllOn ? "Turn this whole session off" : "Turn this whole session on"}
                              >
                                {slotTitle(slot)}
                              </button>
                            </td>
                            {MODES.map((mode) => (
                              <td key={mode} className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={config.grid[slot][mode]}
                                  onChange={() => toggleCell(level, slot, mode)}
                                  aria-label={`${level} ${slotTitle(slot)} ${MODE_LABELS[mode]}`}
                                  className="h-5 w-5 rounded border-[var(--border)] accent-[var(--accent)]"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weekly pattern */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Weekly pattern</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            Which weekdays each level&apos;s sessions actually meet. Left on Auto, a sitting
            alternates Mon·Fri·Sat and Tue·Wed·Thu between consecutive batches and Weekend means
            Saturday only — the rule this school has always run on. Switch a session to Custom to
            pin it to specific days instead, for when a batch&apos;s timetable no longer follows
            that rule. Changing this only affects days generated from here on — it does not touch
            classes already on the calendar.
          </p>

          <div className="space-y-8">
            {LEVELS.map((level) => (
              <div key={level} className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-6">
                <h3 className="mb-3 text-base font-bold text-[var(--foreground)]">{level}</h3>
                <div className="space-y-3">
                  {SESSIONS.map((slot) => {
                    const days = cellDays(level, slot);
                    const custom = days !== null;
                    return (
                      <div
                        key={slot}
                        className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0"
                      >
                        <span className="w-24 shrink-0 font-medium text-[var(--foreground)]">{slotTitle(slot)}</span>
                        <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                          <input
                            type="checkbox"
                            checked={custom}
                            onChange={(e) => toggleCustom(level, slot, e.target.checked)}
                            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                          />
                          Custom
                        </label>
                        {custom ? (
                          <div className="flex flex-wrap gap-1.5">
                            {PATTERN_WEEKDAYS.map(({ day, label }) => (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleDay(level, slot, day)}
                                aria-label={`${level} ${slotTitle(slot)} ${label}`}
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                  days!.includes(day)
                                    ? "bg-[var(--accent)] text-white"
                                    : "bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">{autoHint(slot)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            {patternMsg && (
              <p className={`text-sm font-medium ${patternMsg.startsWith("Saved") ? "text-emerald-700" : "text-red-700"}`}>
                {patternMsg}
              </p>
            )}
            <button
              onClick={savePattern}
              disabled={patternSaving}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {patternSaving ? "Saving..." : "Save weekly pattern"}
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={loadSettings}
            className="rounded-lg border border-[var(--border)] px-6 py-3 font-semibold text-[var(--foreground)] transition hover:bg-[var(--background)]"
            disabled={saving}
          >
            Reset
          </button>
          <button
            onClick={() => submitSettings("preview")}
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {pendingImpact && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-5">
          <div className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--foreground)]">This moves students</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Saving these settings changes which session enrolled students are in. Review before you apply it.
            </p>

            <div className="mt-4 space-y-4 text-sm">
              {pendingImpact.moves.length > 0 && (
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Auto-moved (same mode, new time)</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--muted)]">
                    {pendingImpact.moves.map((m, i) => (
                      <li key={i}>
                        <strong className="text-[var(--foreground)]">{m.count}</strong>{" "}
                        {m.level} {modeWord(m.mode)} student{m.count === 1 ? "" : "s"} —{" "}
                        {slotTitle(m.from)} → <strong className="text-[var(--foreground)]">{slotTitle(m.to)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pendingImpact.stranded.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <p className="font-semibold">No session left for their mode — the office will be notified</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {pendingImpact.stranded.map((s, i) => (
                      <li key={i}>
                        <strong>{s.count}</strong> {s.level} {modeWord(s.mode)} student{s.count === 1 ? "" : "s"} —
                        not moved. Re-place them on /admin/students.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pendingImpact.tutorWarnings.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-[var(--muted)]">
                  <p className="font-semibold text-[var(--foreground)]">Tutors that may lose classes</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {pendingImpact.tutorWarnings.map((t, i) => (
                      <li key={i}>{t.name} — {t.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setPendingImpact(null)}
                disabled={saving}
                className="rounded-lg border border-[var(--border)] px-5 py-2.5 font-semibold text-[var(--foreground)] transition hover:bg-[var(--background)]"
              >
                Cancel
              </button>
              <button
                onClick={() => submitSettings("confirm")}
                disabled={saving}
                className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Applying..." : "Save & move students"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
