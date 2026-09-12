"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import { StarIcon } from "@/components/icons";

/**
 * "HOW WAS TODAY'S CLASS?" — the last card on the end-of-class screen, and
 * only for a student who has never answered it before. See the module
 * comment on /api/student/live-feedback for the "ask until it lands" rule;
 * this component just renders whatever that endpoint says is due. "Not now"
 * hides it for this visit without marking it answered, so it comes back on
 * the next class's end screen.
 */
export default function LiveClassFeedbackCard({
  liveSessionId,
  sessionTitle,
}: {
  liveSessionId: string | null;
  sessionTitle: string;
}) {
  const [due, setDue] = useState(false);
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/live-feedback", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { due: false }))
      .then((data: { due?: boolean }) => {
        if (!cancelled) setDue(Boolean(data.due));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked || !due || dismissed) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rating) {
      setError("Tap a star to rate today's class.");
      return;
    }
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/student/live-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          message: comment.trim() || "No comment left.",
          sessionId: liveSessionId,
          sessionTitle,
        }),
      });
      if (!res.ok) throw new Error("Could not send your feedback.");
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your feedback.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Mascot mood="curious" className="h-14 w-14 shrink-0" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Becca asks</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">How was today&apos;s class?</h2>
        </div>
      </div>

      {sent ? (
        <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
          Thanks — that went straight to the office.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                aria-pressed={rating >= value}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition ${
                  rating >= value
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                <StarIcon
                  className="h-5 w-5"
                  fill={rating >= value ? "currentColor" : "none"}
                  strokeWidth={rating >= value ? 1.2 : 1.8}
                />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Anywhere we should improve? (optional)"
            className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          {error ? <p className="text-sm font-semibold text-red-500">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sending}
              className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send feedback"}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-[var(--muted)]"
            >
              Not now
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
