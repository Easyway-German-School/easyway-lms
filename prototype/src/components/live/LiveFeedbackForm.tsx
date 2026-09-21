"use client";

import { useState } from "react";
import { StarIcon } from "@/components/icons";

export type FeedbackRole = "student" | "tutor";

/** Sessions the person tapped "Not now" on, kept on THIS device so a skip is not a lost answer. */
const SKIPPED_KEY = "easyway:live-feedback-skipped";
const MAX_REMEMBERED = 30;

export function skippedSessions(): string[] {
  try {
    const raw = window.localStorage.getItem(SKIPPED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSkip(sessionId: string): void {
  try {
    const next = [sessionId, ...skippedSessions().filter((id) => id !== sessionId)].slice(0, MAX_REMEMBERED);
    window.localStorage.setItem(SKIPPED_KEY, JSON.stringify(next));
  } catch {
    /* Private window or blocked storage: the ask simply comes back next visit. */
  }
}

const COPY: Record<FeedbackRole, { heading: string; prompt: string; placeholder: string; thanks: string }> = {
  student: {
    heading: "How was today's class?",
    prompt: "Tap a star to rate it.",
    placeholder: "Anything we should improve? (optional)",
    thanks: "Thanks — that went straight to the office.",
  },
  tutor: {
    heading: "How did the class go?",
    prompt: "Tap a star to rate it.",
    placeholder: "Anything that got in the way — audio, video, students, materials? (optional)",
    thanks: "Thanks — the office has it.",
  },
};

/**
 * The rating itself: five stars, one optional box, send or skip. Shared by the
 * end-of-class screen and the popup that follows people who left without
 * answering, so both look and behave the same.
 */
export default function LiveFeedbackForm({
  sessionId,
  sessionTitle,
  role,
  onDone,
}: {
  sessionId: string;
  sessionTitle: string;
  role: FeedbackRole;
  /** Called after a send (after the thank-you has been shown) or a skip. */
  onDone: (outcome: "sent" | "skipped") => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const copy = COPY[role];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rating) {
      setError(copy.prompt);
      return;
    }
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/live/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, rating, message: comment.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      // 409 means it was already answered somewhere else (another tab, the end
      // screen): that is a thank-you, not an error.
      if (!res.ok && res.status !== 409) throw new Error(data?.error || "Could not send your feedback.");
      setSent(true);
      window.setTimeout(() => onDone("sent"), 1800);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your feedback.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">
        {copy.thanks}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-[var(--muted)]">{sessionTitle}</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            onClick={() => setRating(value)}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            className={`grid h-11 w-11 place-items-center rounded-xl border transition ${
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
        placeholder={copy.placeholder}
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
          onClick={() => {
            rememberSkip(sessionId);
            onDone("skipped");
          }}
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-[var(--muted)]"
        >
          Not now
        </button>
      </div>
    </form>
  );
}

export function feedbackHeading(role: FeedbackRole): string {
  return COPY[role].heading;
}
