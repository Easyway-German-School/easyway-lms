"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "Pick your hybrid sittings" — a one-time tap-only popup for an existing
 * hybrid student who signed up before the combo picker existed (see
 * lib/hybrid-combo.ts). They registered under a single vague "hybrid" mode
 * with no concrete online sitting, which is the same gap that let a tutor's
 * coverage silently absorb every online/hybrid student at their level —
 * this closes it retroactively, one student at a time, the same way
 * CohortCheckMoment closes the batch/start-date gap.
 *
 * GET /api/student/hybrid-combo says `due: true` only while
 * `hybridOnlineSlot` is unset on a hybrid student; answering here runs the
 * exact same auto-assign engine a new signup's combo pick does.
 */

type Status = { due: boolean; combos: Array<{ id: string; label: string }> };

export default function HybridComboMoment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pickedLabel, setPickedLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/hybrid-combo", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => {
        if (cancelled) return;
        setStatus(data && data.due ? data : null);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && status);
  const { open, close } = useMoment("hybrid-combo", due);

  if (!open || !status || typeof document === "undefined") return null;

  const answer = async (comboId: string) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/student/hybrid-combo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save that.");
      setPickedLabel(data?.combo?.label ?? "");
      setDone(true);
      setTimeout(close, 2600);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  const optionClass =
    "w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3.5 text-left text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Pick your class times"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6 text-center">
          <Mascot mood="curious" className="mx-auto h-20 w-20" />
        </div>

        {done ? (
          <div className="p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Got it</p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Thanks — that's saved</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {pickedLabel ? `You're set for ${pickedLabel}. ` : ""}
              We're matching you with your campus and online tutors now.
            </p>
          </div>
        ) : (
          <div className="p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">System update</p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Which sittings will you attend?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              We've made hybrid classes more specific — pick the campus sitting you attend in person, paired with the
              online sitting you join over video, and we'll pair you with both tutors.
            </p>

            <div className="mt-4 space-y-2.5">
              {status.combos.map((combo) => (
                <button key={combo.id} type="button" disabled={saving} onClick={() => answer(combo.id)} className={optionClass}>
                  {combo.label}
                </button>
              ))}
            </div>

            {error ? <p className="mt-3 text-sm font-semibold text-red-500">{error}</p> : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
