"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ClassRecap, { type ClassRecapData } from "@/components/notes/ClassRecap";

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
  /** Recordings part-way through being transcribed, and how much of their audio is done. */
  partial?: { count: number; percent: number };
  /** The model that will write the next recap. */
  notesModel?: string;
  inProgress: number;
  /** Everything still waiting for the queue: recordings and handouts. */
  backlog?: { recordings: number; documents: number };
  /** Groq's free-tier quotas known to be out right now, and roughly when they free up. */
  coolingDown?: { asrUntil: number | null; chatUntil: number | null };
  noTranscriptYet: number;
  failed: number;
  skippedTooLarge: number;
  noSpeech: number;
  failures: Array<{
    id: string;
    title: string;
    level: string | null;
    isPrivate: boolean;
    status: string;
    error: string | null;
    when: string;
  }>;
  /** The most recently finished recaps — click one to see what it actually says. */
  recentReady?: Array<{
    id: string;
    title: string;
    level: string | null;
    isPrivate: boolean;
    outline: boolean;
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

/** "in 9 min" / "in under a minute" — never a clock time, since the wait itself may be a mis-parsed guess. */
function inAbout(until: number): string {
  const minutes = Math.ceil((until - Date.now()) / 60_000);
  return minutes <= 1 ? "in under a minute" : `in about ${minutes} min`;
}

const STATUS_LABEL: Record<string, string> = {
  failed: "Failed",
  skipped_too_large: "Too large",
  none: "No speech",
  partial: "Slow — resuming",
  ready: "Ready",
};

type NoteDetail = {
  id: string;
  title: string;
  level: string | null;
  startedAt: string;
  durationSeconds: number | null;
  isPrivate: boolean;
  status: string;
  error: string | null;
  provider: string | null;
  generatedAt: string | null;
  transcribedUntil: number | null;
  recap: ClassRecapData;
  transcriptText: string | null;
  segmentCount: number;
};

/**
 * Opens one class's note as it would actually render for a student (reusing
 * `ClassRecap`, the exact same component `/notes/class/[id]` uses) plus the raw
 * transcript underneath — so "why does this note look thin" or "is this even
 * working" has a real answer instead of a status word.
 */
function NotePreview({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/admin/class-notes/${id}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!cancelled) setDetail(body as NoteDetail);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this note.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Class note preview</p>
            {detail ? <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">{detail.title}</h2> : null}
            {detail ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {[
                  detail.level,
                  detail.isPrivate ? "private lesson" : null,
                  new Date(detail.startedAt).toLocaleDateString(),
                  STATUS_LABEL[detail.status] ?? detail.status,
                  detail.provider ? `via ${detail.provider}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {!error && !detail ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
          {detail && !detail.recap.summary && detail.status !== "ready" ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm text-[var(--muted)]">
              {detail.status === "partial"
                ? `Part-way through — ${detail.durationSeconds && detail.transcribedUntil ? Math.round((Math.min(detail.transcribedUntil, detail.durationSeconds) / detail.durationSeconds) * 100) : 0}% of the audio transcribed so far. Whatever it has picked up is below.`
                : "No summary yet for this class."}
              {detail.error ? <p className="mt-2 break-words font-mono text-[11px]">{detail.error}</p> : null}
            </div>
          ) : null}
          {detail?.recap.summary || (detail?.recap.keyPoints?.length ?? 0) > 0 ? <ClassRecap data={detail!.recap} /> : null}

          {detail && (detail.transcriptText || detail.segmentCount > 0) ? (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="text-xs font-semibold text-[var(--accent)]"
              >
                {showTranscript ? "Hide full transcript" : "Show full transcript"}
              </button>
              {showTranscript ? (
                <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-line rounded-2xl bg-[var(--surface-alt)] p-4 text-xs leading-6 text-[var(--muted)]">
                  {detail.transcriptText || "Nothing transcribed yet."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ClassNotesHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const [starting, setStarting] = useState(false);
  const [startNote, setStartNote] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

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

      {health.coolingDown?.asrUntil ? (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--foreground)]">
          <p className="font-semibold">
            Groq&rsquo;s free transcription limit is used up for now — resuming automatically {inAbout(health.coolingDown.asrUntil)}.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            This is an hourly or daily allowance on the free plan, not a bug — a backlog this size can genuinely need
            more speech-to-text time than a day of the free tier holds. It will keep chipping away on its own; to
            clear it faster today, Groq&rsquo;s paid tier (their own suggestion, cents per hour of audio) removes the cap.
          </p>
        </div>
      ) : null}
      {!health.coolingDown?.asrUntil && health.coolingDown?.chatUntil ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--muted)]">
          Groq&rsquo;s free write-up limit is used up for now — new recaps resuming {inAbout(health.coolingDown.chatUntil)}.
          Recordings keep transcribing either way; ready notes just arrive as a plain outline in the meantime.
        </div>
      ) : null}

      {startNote || waiting > 0 ? (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--foreground)]">
          {startNote ? <p className="font-semibold">{startNote}</p> : null}
          {waiting > 0 ? (
            <p className={startNote ? "mt-1 text-[var(--muted)]" : "text-[var(--muted)]"}>
              {waiting} waiting — {health.backlog?.recordings ?? 0} class recording{(health.backlog?.recordings ?? 0) === 1 ? "" : "s"}
              {(health.backlog?.documents ?? 0) > 0 ? `, ${health.backlog?.documents} handout${health.backlog?.documents === 1 ? "" : "s"}` : ""}.
              {(health.partial?.count ?? 0) > 0
                ? ` ${health.partial!.count} part-way through (${health.partial!.percent}% of their audio done).`
                : ""}
              {" "}This works itself down after every class and every morning; the numbers refresh here every few seconds.
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
          {health.failures.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setPreviewId(f.id)}
                className="w-full rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2 text-left text-xs transition hover:border-rose-300"
              >
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
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {(health.recentReady?.length ?? 0) > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Recent notes — tap one to see it
          </p>
          <ul className="space-y-1.5">
            {health.recentReady!.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setPreviewId(r.id)}
                  className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-left text-xs transition hover:border-[var(--accent)]"
                >
                  <span className="font-semibold text-[var(--foreground)]">{r.title}</span>
                  {r.level ? <span className="text-[var(--muted)]">{r.level}</span> : null}
                  {r.isPrivate ? <span className="text-[var(--muted)]">· private</span> : null}
                  {r.outline ? (
                    <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                      auto-outline
                    </span>
                  ) : null}
                  <span className="ml-auto text-[var(--muted)]">{new Date(r.when).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {previewId ? <NotePreview id={previewId} onClose={() => setPreviewId(null)} /> : null}
    </div>
  );
}
