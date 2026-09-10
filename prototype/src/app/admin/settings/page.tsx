"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { SlidersIcon } from "@/components/icons";
import {
  LEVELS,
  SESSION_SLOTS as SESSIONS,
  MODE_SLOTS as MODES,
  MODE_LABELS,
  defaultSessionSettings,
  type SessionSettings as Settings,
  type SessionConfig,
} from "@/lib/school-settings";
import { MONTH_NAMES } from "@/lib/batch";
import { defaultCurrentIntake, type CurrentIntake } from "@/lib/intake";

/** Any of the seven boolean columns on a level row. */
type Toggle = keyof Omit<SessionConfig, "level">;

type MovePreview = { level: string; kind: "slot" | "mode"; from: string; to: string; count: number };
type StrandPreview = { level: string; from: string; count: number };
type TutorWarning = { name: string; detail: string };

type ImpactResponse = {
  affected: number;
  moves: MovePreview[];
  stranded: StrandPreview[];
  tutorWarnings: TutorWarning[];
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => defaultSessionSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Filled after a preview call when a save would move real students. The
  // confirm dialog reads it; confirming re-POSTs with { confirm: true }.
  const [pendingImpact, setPendingImpact] = useState<ImpactResponse | null>(null);

  // The school's current intake — the month a new student joins by default
  // when the sign-up form, the Add-student form or the CSV import did not
  // carry one. See lib/intake.ts.
  const [intake, setIntake] = useState<CurrentIntake>(() => defaultCurrentIntake());
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeMsg, setIntakeMsg] = useState("");

  useEffect(() => {
    loadSettings();
    loadIntake();
  }, []);

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
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      setMessage("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Send the current toggles to the server.
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
          // Nothing to move — save immediately.
          await submitSettings("confirm");
        }
        return;
      }

      // confirm
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

  /**
   * Keyed by level, not by array index, and immutable.
   *
   * The index version broke twice over: it mutated the row in place inside a
   * setState updater, so React saw the same object reference and could skip
   * the re-render, and it assumed the stored order matched the order this page
   * renders — which stops being true the moment a level is missing from the
   * saved value.
   */
  function toggle(level: string, key: Toggle) {
    setSettings((prev) => ({
      sessions: prev.sessions.map((row) =>
        row.level === level ? { ...row, [key]: !row[key] } : row,
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
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <SlidersIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Settings</h1>
          </div>
          <p className="text-[var(--muted)]">Configure class sessions and availability for each level</p>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`rounded-lg px-4 py-3 text-sm font-medium ${
              message.includes("success") || message.toLowerCase().includes("saved")
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
            Set this to the intake you are currently taking people into. It does not touch
            students who already have a batch.
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
                  <option key={m} value={m}>
                    {m}
                  </option>
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
            <p
              className={`mt-3 text-sm font-medium ${
                intakeMsg.startsWith("Saved") ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {intakeMsg}
            </p>
          )}
        </div>

        {/* Sessions Configuration */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Class sessions &amp; attendance</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            Turn off a session slot or an attendance mode a level no longer runs. It disappears
            from student registration and its community room is hidden. Students already in it are
            moved to the nearest option that still runs, and are told. Re-enabling it later does
            not bring anyone back automatically.
          </p>

          <div className="space-y-6">
            {LEVELS.map((level) => {
              const config = settings.sessions.find((s) => s.level === level);
              if (!config) return null;

              return (
                <div
                  key={level}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6"
                >
                  <h3 className="mb-4 text-base font-bold text-[var(--foreground)]">{level}</h3>

                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Session slots
                  </p>
                  <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {SESSIONS.map((slot) => (
                      <label
                        key={`${level}-${slot}`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-[var(--surface)]"
                      >
                        <input
                          type="checkbox"
                          checked={config[slot]}
                          onChange={() => toggle(level, slot)}
                          className="h-5 w-5 rounded border-[var(--border)] accent-[var(--accent)]"
                        />
                        <span className="font-medium capitalize text-[var(--foreground)]">{slot}</span>
                      </label>
                    ))}
                  </div>

                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Ways to attend
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {MODES.map((mode) => (
                      <label
                        key={`${level}-${mode}`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-[var(--surface)]"
                      >
                        <input
                          type="checkbox"
                          checked={config[mode]}
                          onChange={() => toggle(level, mode)}
                          className="h-5 w-5 rounded border-[var(--border)] accent-[var(--accent)]"
                        />
                        <span className="font-medium text-[var(--foreground)]">{MODE_LABELS[mode]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
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

      {/* Confirm dialog — only when a save would move real students */}
      {pendingImpact && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-5">
          <div className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[var(--foreground)]">This moves students</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Saving these settings changes where enrolled students are. Review before you apply it.
            </p>

            <div className="mt-4 space-y-4 text-sm">
              {pendingImpact.moves.length > 0 && (
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Auto-moved</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--muted)]">
                    {pendingImpact.moves.map((m, i) => (
                      <li key={i}>
                        <strong className="text-[var(--foreground)]">{m.count}</strong>{" "}
                        {m.level} {m.kind === "slot" ? "" : "student"}
                        {m.count === 1 ? "" : "s"} — {m.from} → <strong className="text-[var(--foreground)]">{m.to}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pendingImpact.stranded.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <p className="font-semibold">Left with no class — the office will be notified</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {pendingImpact.stranded.map((s, i) => (
                      <li key={i}>
                        <strong>{s.count}</strong> {s.level} {s.from} student{s.count === 1 ? "" : "s"} —
                        not moved (no campus nearby). Re-place them on /admin/students.
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
                      <li key={i}>
                        {t.name} — {t.detail}
                      </li>
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
