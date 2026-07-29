"use client";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";

export default function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    fullName: "",
    email: "",
    phone: "",
    notifications: true,
    courseUpdates: true,
    examAlerts: true,
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/student/profile");
        if (!res.ok) return;
        const data = await res.json();
        setFormState((prev) => ({
          ...prev,
          fullName: data.user?.name || "",
          email: data.user?.email || "",
          phone: data.student?.admission?.phone || "",
        }));
      } catch {
        // ignore
      }
    }

    loadSettings();
  }, []);

  async function handleSaveSettings() {
    setMessage(null);
    setSaving(true);

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formState.fullName,
          email: formState.email,
          phone: formState.phone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Unable to save settings.");
        return;
      }

      setMessage("Settings saved successfully.");
    } catch (error) {
      setMessage("Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Settings</p>
                <h1 className="mt-3 text-3xl font-semibold">Account preferences</h1>
                <p className="mt-2 text-sm text-[var(--muted)]">Update your profile, notification preferences, and exam alert settings.</p>
              </div>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Profile settings</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Update your email and contact details.</p>

                <div className="mt-6 space-y-4">
                  {/*
                    Name is deliberately read-only. It appears on certificates and
                    exam registrations, so it has to match the student's official
                    documents — a self-service edit here would quietly invalidate
                    those. Corrections go through the branch office.
                  */}
                  <div className="block">
                    <span className="text-sm font-medium text-[var(--foreground)]">Full name</span>
                    <div className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[var(--muted)]">
                      {formState.fullName || "—"}
                    </div>
                    <p className="mt-1.5 px-1 text-xs text-[var(--muted)]">
                      Your name appears on certificates and exam entries. Contact your branch office to correct it.
                    </p>
                  </div>
                  <label className="block">
                    <span className="text-sm font-medium text-[var(--foreground)]">Email address</span>
                    <input
                      type="email"
                      value={formState.email}
                      onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                      className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[var(--foreground)]">Phone number</span>
                    <input
                      value={formState.phone}
                      onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                      className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Notifications</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Control the messages you receive from Easyway.</p>

                <div className="mt-6 space-y-4">
                  {[
                    { label: "Course updates", key: "courseUpdates" },
                    { label: "Exam alerts", key: "examAlerts" },
                    { label: "General notifications", key: "notifications" },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm">
                      <span>{item.label}</span>
                      <input
                        type="checkbox"
                        checked={(formState as any)[item.key]}
                        onChange={(e) => setFormState((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                        className="h-5 w-5 rounded border-slate-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                      />
                    </label>
                  ))}
                </div>
              </section>
            </div>

            {message ? (
              <div className="mt-6 rounded-3xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] p-4 text-sm text-[var(--accent)]">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </StudentShell>
  );
}
