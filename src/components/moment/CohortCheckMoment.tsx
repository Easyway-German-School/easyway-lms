"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "WHEN DID YOU START?" — a tick-box-only popup, for any student the server
 * doesn't yet have a batch month or a confirmed start date for. Typing an
 * answer is exactly the friction the office does not want during the manual
 * onboarding push, so this is at most two taps, never a text field.
 *
 * Those two fields are the entire input the rest of the portal needs: the
 * journey map's countdown and arrival estimate (germany-journey.ts) and the
 * calendar's rotation (schedule-resolve.ts) both already redraw themselves
 * from `classesStartedAt` / `admission.batch` alone — this popup only has to
 * get an honest answer into those two fields, once, and everything downstream
 * follows automatically. See the route's module comment for why this can't
 * just reuse the journey map's own "have you started?" question.
 *
 * The server (GET /api/student/cohort-check) says `due: true` for anyone
 * missing either field who hasn't answered yet — a student who already has
 * both on file never sees this. Left un-answered it reappears every visit,
 * same as every other un-dismissed moment; there is no "later" here because
 * there is nothing later to lose — it's one or two taps.
 */

type Status = { due: boolean; months: string[]; firstName: string | null };
type Finish = { level: string; endsOnLabel: string; daysLeft: number } | null;

export default function CohortCheckMoment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<"ask" | "when">("ask");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [finish, setFinish] = useState<Finish>(null);

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
      const data = await res.json().catch(() => ({}));
      setFinish(data?.finish ?? null);
      setDone(true);
      // A little longer when there's an estimate worth reading.
      setTimeout(close, data?.finish ? 3200 : 1400);
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
            {finish ? (
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Your calendar and journey map are set — at this pace, you're on track to finish{" "}
                <span className="font-semibold text-[var(--foreground)]">{finish.level}</span> around{" "}
                <span className="font-semibold text-[var(--foreground)]">{finish.endsOnLabel}</span>.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">We'll make sure your dashboard matches.</p>
            )}
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
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Pick the month, roughly is fine — we'll work out the rest.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {status.months.map((month) => (
                <button
                  key={month}
                  type="button"
                  disabled={saving}
                  onClick={() => answer({ status: "ongoing", startedMonth: month })}
                  className={optionClass + " px-2 py-3 text-center text-xs"}
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
