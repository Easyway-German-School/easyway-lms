"use client";

import { useEffect, useState } from "react";

/**
 * A compact read-out of the class-notes / transcript pipeline, so "there is
 * nothing in My Notes" has a visible cause. Sits on the Live classes page
 * because that is where the office goes to check on live teaching, which is
 * what feeds it. Read-only; hides itself if the read fails.
 */

type Health = {
  windowDays: number;
  transcriptionConfigured: boolean;
  whisperModel: string;
  eligibleRecordings: number;
  incompleteRecordings: number;
  ready: number;
  inProgress: number;
  noTranscriptYet: number;
  failed: number;
  skippedTooLarge: number;
  noSpeech: number;
  failures: Array<{
    title: string;
    level: string | null;
    isPrivate: boolean;
    status: string;
    error: string | null;
    when: string;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  failed: "Failed",
  skipped_too_large: "Too large",
  none: "No speech",
};

export default function ClassNotesHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/class-notes-health", { cache: "no-store" });
        if (!res.ok) throw new Error("read failed");
        const data = (await res.json()) as Health;
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !health) return null;

  const chips: Array<{ label: string; value: number; tone: string }> = [
    { label: "Notes ready", value: health.ready, tone: "text-emerald-600" },
    { label: "In progress", value: health.inProgress, tone: "text-amber-600" },
    { label: "Failed", value: health.failed + health.skippedTooLarge, tone: "text-rose-600" },
    { label: "No speech", value: health.noSpeech, tone: "text-[var(--muted)]" },
  ];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">Class notes &amp; transcripts</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            AI recaps from recorded classes, last {health.windowDays} days.
            {!health.transcriptionConfigured ? (
              <span className="ml-1 font-semibold text-rose-600">
                Transcription is off — GROQ_API_KEY is not set, so no recaps are being made.
              </span>
            ) : null}
          </p>
        </div>
        {health.failures.length > 0 ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            {open ? "Hide" : `Show ${health.failures.length} problem${health.failures.length === 1 ? "" : "s"}`}
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((chip) => (
          <div key={chip.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
            <p className={`text-xl font-bold ${chip.tone}`}>{chip.value}</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{chip.label}</p>
          </div>
        ))}
      </div>

      {health.eligibleRecordings === 0 ? (
        <p className="mt-3 rounded-xl bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--muted)]">
          No completed class recordings in this window
          {health.incompleteRecordings > 0
            ? ` — ${health.incompleteRecordings} started but never finished recording.`
            : ". A live class only produces notes if the tutor records it."}
        </p>
      ) : null}

      {open && health.failures.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {health.failures.map((f, i) => (
            <li key={i} className="rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--foreground)]">{f.title}</span>
                {f.level ? <span className="text-[var(--muted)]">{f.level}</span> : null}
                {f.isPrivate ? <span className="text-[var(--muted)]">· private</span> : null}
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
                  {STATUS_LABEL[f.status] ?? f.status}
                </span>
                <span className="ml-auto text-[var(--muted)]">{new Date(f.when).toLocaleDateString()}</span>
              </div>
              {f.error ? <p className="mt-1 break-words text-[var(--muted)]">{f.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
