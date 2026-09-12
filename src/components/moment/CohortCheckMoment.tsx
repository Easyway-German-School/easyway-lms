"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "WHICH ONE ARE YOU?" — a tick-box-only popup for the students the current
 * manual onboarding push is confusing: an account that could equally be a
 * brand-new signup or somebody finishing the class they already started.
 * Typing an answer is exactly the friction the office does not want right
 * now, so this is two taps, never a text field.
 *
 * The server (GET /api/student/cohort-check) only says `due: true` for an
 * account its own classifier cannot confidently place or that contradicts
 * itself — see the route's module comment. A clean, confident account never
 * sees this. Left un-answered it reappears daily, same as every other
 * un-dismissed moment; there is no "later" here because there is nothing
 * later to lose — it's two taps.
 */

type Status = { due: boolean; months: string[]; firstName: string | null };

export default function CohortCheckMoment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<"ask" | "when">("ask");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/cohort-check", { cache: "no-store" })
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
  const { open, close } = useMoment("cohort-check", due);

  if (!open || !status || typeof document === "undefined") return null;

  const answer = async (payload: { status: "new" | "ongoing"; startedMonth?: string }) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/student/cohort-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not save that.");
      }
      setDone(true);
      setTimeout(close, 1400);
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
      aria-label="Quick check"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6 text-center">
          <Mascot mood="curious" className="mx-auto h-20 w-20" />
        </div>

        {done ? (
          <div className="p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Got it</p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Thanks — that's saved</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">We'll make sure your dashboard matches.</p>
          </div>
        ) : step === "ask" ? (
          <div className="p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
              {status.firstName ? `Quick one, ${status.firstName}` : "Quick one"}
            </p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Which one is you?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              We're moving students onto the portal by hand right now, and we want your dashboard to show the right
              class for you. No typing — just tap one.
            </p>

            <div className="mt-4 space-y-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={() => answer({ status: "new" })}
                className={optionClass}
              >
                🆕 I'm brand new — this is my first time starting classes
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setStep("when")}
                className={optionClass}
              >
                📚 I'm already in class — just continuing on the portal
              </button>
            </div>

            {error ? <p className="mt-3 text-sm font-semibold text-red-500">{error}</p> : null}
          </div>
        ) : (
          <div className="p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">One more tap</p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">When did your classes start?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Pick the month, roughly is fine.</p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {status.months.map((month) => (
                <button
                  key={month}
                  type="button"
                  disabled={saving}
                  onClick={() => answer({ status: "ongoing", startedMonth: month })}
                  className={optionClass + " text-center"}
                >
                  {month}
                </button>
              ))}
            </div>

            {error ? <p className="mt-3 text-sm font-semibold text-red-500">{error}</p> : null}

            <button
              type="button"
              onClick={() => setStep("ask")}
              className="mt-4 text-xs font-medium text-[var(--muted)]"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
