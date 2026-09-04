"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { SlidersIcon } from "@/components/icons";
import {
  LEVELS,
  SESSION_SLOTS as SESSIONS,
  defaultSessionSettings,
  type SessionSettings as Settings,
  type SessionSlot,
} from "@/lib/school-settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => defaultSessionSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

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

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage("Settings saved successfully!");
        setTimeout(() => setMessage(""), 3000);
      } else {
        const data = await res.json();
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
  function toggleSession(level: string, session: SessionSlot) {
    setSettings((prev) => ({
      sessions: prev.sessions.map((row) =>
        row.level === level ? { ...row, [session]: !row[session] } : row,
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
              message.includes("success") || message.includes("saved")
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}

        {/* Sessions Configuration */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="mb-6 text-lg font-bold text-[var(--foreground)]">Class Sessions</h2>
          <p className="mb-6 text-sm text-[var(--muted)]">
            Toggle which session slots are available for each course level. Disabled sessions won't appear during student registration and their communities will be hidden.
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
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {SESSIONS.map((session) => (
                      <label
                        key={`${level}-${session}`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-[var(--surface)]"
                      >
                        <input
                          type="checkbox"
                          checked={config[session]}
                          onChange={() => toggleSession(level, session)}
                          className="h-5 w-5 rounded border-[var(--border)] accent-[var(--accent)]"
                        />
                        <span className="font-medium text-[var(--foreground)] capitalize">{session}</span>
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
            onClick={saveSettings}
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
