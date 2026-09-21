"use client";

import { useEffect, useState } from "react";

/**
 * A compact read-out of the class-notes / transcript pipeline, so "there is
 * nothing in My Notes" has a visible cause. The queue works itself — after every
 * recorded class and every morning — so "Run now" only starts it a little sooner;
 * it runs on the server and does not need this page to stay open. Sits on the
 * Live classes page. Hides itself if the read fails.
 */

type Health = {
  windowDays: number;
  transcriptionConfigured: boolean;
  whisperModel: string;
  ffmpeg?: { ok: boolean; detail: string };
  eligibleRecordings: number;
  incompleteRecordings: number;
  ready: number;
  /** Ready, but an auto-outline written while no AI model was reachable. */
  outlines?: number;
  /** The model that will write the next recap. */
  notesModel?: string;
  inProgress: number;
  /** Everything still waiting for the queue: recordings and handouts. */
  backlog?: { recordings: number; documents: number };
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
  documents?: {
    ready: number;
    pending: number;
    failed: number;
    skipped: number;
    awaitingTutorReview: number;
  };
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

  const [starting, setStarting] = useState(false);
  const [startNote, setStartNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/class-notes-health", { cache: "no-store" });
      if (!res.ok) throw new Error("read failed");
      setHealth((await res.json()) as Health);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // While anything is waiting, keep the numbers fresh so the page shows the
  // background run working. Purely cosmetic: the run does not need this page.
  const waiting = health ? (health.backlog?.recordings ?? 0) + (health.backlog?.documents ?? 0) : 0;
  useEffect(() => {
    if (waiting === 0) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  // Starts the same self-driving run that follows every recorded class and the
  // morning cron. It happens on the server, so closing this page is fine.
  const start = async () => {
    setStarting(true);
    setStartNote(null);
    try {
      const res = await fetch("/api/admin/class-notes-health", { method: "POST" });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r?.error || `HTTP ${res.status}`);
      setStartNote(
        r.started
          ? "Started. It works through the queue by itself now — you can close this page."
          : `Ran a short pass here: ${r.recordings?.created ?? 0} class recap${r.recordings?.created === 1 ? "" : "s"} written.`,
      );
    } catch (e) {
      setStartNote(`Could not start it (${e instanceof Error ? e.message : "unknown"}). Try again in a minute.`);
    } finally {
      setStarting(false);
      await load();
    }
  };

  if (failed || !health) return null;

  const chips: Array<{ label: string; value: number; tone: string }> = [
    { label: "Notes ready", value: health.ready, tone: "text-emerald-600" },
    { label: "In progress", value: health.inProgress, tone: "text-amber-600" },
    { label: "Failed", value: health.failed + health.skippedTooLarge, tone: "text-rose-600" },
    { label: "No speech", value: health.noSpeech, tone: "text-[var(--muted)]" },
  ];

  const d = health.documents;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">Class notes &amp; transcripts</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Recaps from recorded classes, last {health.windowDays} days
            {health.notesModel && health.notesModel !== "mock" ? <> — written by {health.notesModel}</> : null}.
            {health.outlines ? (
              <span className="ml-1">
                {health.outlines} {health.outlines === 1 ? "is" : "are"} an auto-outline made while the AI was unavailable;
                {" "}the full write-up replaces {health.outlines === 1 ? "it" : "them"} automatically.
              </span>
            ) : null}
            {!health.transcriptionConfigured ? (
              <span className="ml-1 font-semibold text-rose-600">
                Transcription is off — GROQ_API_KEY is not set, so no recaps are being made.
              </span>
            ) : null}
          </p>
          {health.ffmpeg && !health.ffmpeg.ok ? (
            <p className="mt-1 text-xs text-rose-600">
              Audio extraction can’t run here — large class recordings will fail until this is fixed.
              <span className="ml-1 font-mono text-[10px] text-[var(--muted)]">{health.ffmpeg.detail}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {health.failures.length > 0 ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              {open ? "Hide" : `Show ${health.failures.length} problem${health.failures.length === 1 ? "" : "s"}`}
            </button>
          ) : null}
          <button
            onClick={start}
            disabled={starting || !health.transcriptionConfigured}
            title={
              !health.transcriptionConfigured
                ? "Transcription is off — set GROQ_API_KEY first"
                : "Start working through the queue now. It also runs by itself after every class and every morning."
            }
            className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {starting ? "Starting…" : "Run now"}
          </button>
        </div>
      </div>

      {startNote || waiting > 0 ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--foreground)]">
          {startNote ? <p className="font-semibold">{startNote}</p> : null}
          {waiting > 0 ? (
            <p className={startNote ? "mt-1 text-[var(--muted)]" : "text-[var(--muted)]"}>
              {waiting} waiting — {health.backlog?.recordings ?? 0} class recording{(health.backlog?.recordings ?? 0) === 1 ? "" : "s"}
              {(health.backlog?.documents ?? 0) > 0 ? `, ${health.backlog?.documents} handout${health.backlog?.documents === 1 ? "" : "s"}` : ""}.
              This works itself down after every class and every morning; the numbers refresh here every few seconds.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((chip) => (
          <div key={chip.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
            <p className={`text-xl font-bold ${chip.tone}`}>{chip.value}</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{chip.label}</p>
          </div>
        ))}
      </div>

      {d ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Documents: <span className="font-semibold text-emerald-600">{d.ready}</span> written up
          {d.awaitingTutorReview > 0 ? (
            <>
              , <span className="font-semibold text-amber-600">{d.awaitingTutorReview}</span> awaiting a tutor’s sign-off
            </>
          ) : null}
          {d.pending > 0 ? <>, {d.pending} queued</> : null}
          {d.failed > 0 ? <>, <span className="text-rose-600">{d.failed} failed</span></> : null}
          {d.skipped > 0 ? <>, {d.skipped} with no readable text</> : null}
          .
        </p>
      ) : null}

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
