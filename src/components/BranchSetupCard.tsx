"use client";

import { useEffect, useMemo, useState } from "react";
import { PinIcon } from "@/components/icons";
import { isOnlineBranchName, TIMEZONE_OPTIONS } from "@/lib/online-branch";
import { countries, nigerianStates } from "@/app/auth/signup/options";

/**
 * Shown on the profile page ONLY when the student has no branch. It writes the
 * one that was missing — pick a campus, or say you study online and where in
 * the world you are — through /api/student/placement, which also tells the
 * office. Moving between branches is not offered here; that stays an office
 * action because it re-prices tuition.
 */

type Branch = { id: string; name: string; mode?: string | null };

export default function BranchSetupCard({
  autoOpen = false,
  onPlaced,
}: {
  autoOpen?: boolean;
  onPlaced: () => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mode, setMode] = useState<"campus" | "online">("campus");
  const [branchId, setBranchId] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [stateName, setStateName] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    let active = true;
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((data) => {
        if (active) setBranches(Array.isArray(data.branches) ? data.branches : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const campusBranches = useMemo(
    () => branches.filter((b) => !(b.mode === "online" || isOnlineBranchName(b.name))),
    [branches],
  );

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const payload =
        mode === "campus"
          ? { atCampus: true, branchId }
          : {
              atCampus: false,
              country,
              state: country === "Nigeria" ? stateName : "",
              city: country === "Nigeria" ? "" : city,
              timezone,
            };
      const res = await fetch("/api/student/placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save that.");
      onPlaced();
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    mode === "campus"
      ? Boolean(branchId)
      : Boolean(country) && (country === "Nigeria" ? Boolean(stateName) : Boolean(city));

  return (
    <section className="mx-auto mt-6 w-full max-w-5xl rounded-3xl border border-amber-300 bg-amber-50 p-5 sm:p-7 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
            <PinIcon className="h-4 w-4" /> Set your branch
          </p>
          <h2 className="mt-2 text-2xl font-black text-[var(--foreground)]">Where do you study?</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your profile is not linked to a branch yet, so your class timetable, tutor and study group cannot be set
            up. Pick your campus, or tell us you study online and where in the world you are — the office is told and
            your profile is sorted into the right cohort automatically.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white"
          >
            Set my branch
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-5 grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {(["campus", "online"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  mode === option
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--border)] text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
                }`}
              >
                {option === "campus" ? "I attend a campus" : "I study online"}
              </button>
            ))}
          </div>

          {mode === "campus" ? (
            <label className="text-sm">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Campus</span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
              >
                <option value="">Choose your campus…</option>
                {campusBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Country</span>
                <select
                  value={country}
                  onChange={(event) => {
                    setCountry(event.target.value);
                    setStateName("");
                    setCity("");
                    setTimezone(event.target.value === "Nigeria" ? "Africa/Lagos" : "");
                  }}
                  className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                >
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              {country === "Nigeria" ? (
                <label className="text-sm">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">State</span>
                  <select
                    value={stateName}
                    onChange={(event) => setStateName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                  >
                    <option value="">Choose your state…</option>
                    {nigerianStates.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="text-sm">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">City / region</span>
                  <input
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder="e.g. Berlin"
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                  />
                </label>
              )}

              <label className="text-sm sm:col-span-2">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Your time zone <span className="font-normal normal-case">(so your timetable shows your local time)</span>
                </span>
                <select
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                >
                  <option value="">Choose…</option>
                  {TIMEZONE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={saving || !canSubmit}
              className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save my branch"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-bold text-[var(--foreground)]"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
