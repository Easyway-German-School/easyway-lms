"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import { DocumentIcon, LinkIcon } from "@/components/icons";

type Notes = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  vocabulary: Array<{ de: string; en: string; note?: string }>;
  corrections: Array<{ mistake: string; correction: string; note?: string }>;
  progressHighlights: string[];
};

type Segment = { start: number; end: number; text: string };
type SpeakerRange = { from: number; to: number; speaker: "tutor" | "student" };

type NotesResponse = {
  status: string;
  isPrivate?: boolean;
  notes?: Notes;
  personalFocus?: string | null;
  transcriptText?: string | null;
  segments?: Segment[];
  speakerRanges?: SpeakerRange[];
};

/** "3:05" / "1:02:33" — same clock format the player itself uses. */
function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Which speaker a segment index falls under, or null when no range covers it — most of a real transcript, honestly. */
function speakerAt(index: number, ranges: SpeakerRange[]): "tutor" | "student" | null {
  const range = ranges.find((r) => index >= r.from && index <= r.to);
  return range?.speaker ?? null;
}

/**
 * The Happy-Scribe panel: what the class covered, the vocabulary it taught,
 * the follow-ups mentioned, and the full transcript — plus one line from
 * Becca pointing at whichever of it matters most to this specific student.
 *
 * Only rendered for `kind === "recording"` videos (see WatchPage) — a
 * lesson video a tutor uploaded was never run through this pipeline.
 */
export default function ClassNotesPanel({ materialId, onSeekTo }: { materialId: string; onSeekTo?: (seconds: number) => void }) {
  const [data, setData] = useState<NotesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [linkState, setLinkState] = useState<"idle" | "working" | "copied" | "error">("idle");

  const copyShareLink = () => {
    setLinkState("working");
    fetch(`/api/student/videos/${materialId}/notes/share`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not create a link");
        await navigator.clipboard.writeText(body.url);
        setLinkState("copied");
        window.setTimeout(() => setLinkState("idle"), 2500);
      })
      .catch(() => setLinkState("error"));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/student/videos/${materialId}/notes`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ status: "failed" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  if (loading) return null; // The video itself is the thing worth showing first; notes fade in quietly.

  if (!data || data.status !== "ready" || !data.notes) {
    // "pending"/"transcribing"/"summarizing" all read as "still coming" to a
    // student — the distinction only matters to whoever is debugging the queue.
    const stillGenerating = ["pending", "transcribing", "summarizing"].includes(data?.status ?? "");
    if (!stillGenerating) return null;
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Class notes are being generated — check back in a few minutes.
      </div>
    );
  }

  const { notes, personalFocus, transcriptText, isPrivate, segments = [], speakerRanges = [] } = data;
  const SPEAKER_LABEL: Record<"tutor" | "student", string> = { tutor: "Tutor", student: isPrivate ? "You" : "Student" };

  return (
    <div className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Class notes</p>
            {isPrivate ? (
              <span className="rounded-full bg-gradient-to-r from-[#FF6600] to-[#FFC46B] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Private
              </span>
            ) : null}
          </div>
          <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">What this class covered</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isPrivate ? (
            <button
              onClick={copyShareLink}
              disabled={linkState === "working"}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
            >
              <LinkIcon className="h-4 w-4" />
              {linkState === "copied" ? "Link copied" : linkState === "error" ? "Try again" : "Copy link"}
            </button>
          ) : null}
          <a
            href={`/api/student/videos/${materialId}/notes/pdf`}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <DocumentIcon className="h-4 w-4" />
            Export PDF
          </a>
        </div>
      </div>

      {personalFocus ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-4">
          <Mascot mood="presenting" className="h-10 w-10 shrink-0" />
          <p className="text-sm leading-6 text-[var(--foreground)]">{personalFocus}</p>
        </div>
      ) : null}

      <p className="text-sm leading-6 text-[var(--muted)]">{notes.summary}</p>

      {notes.keyPoints.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Key points</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {notes.keyPoints.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="text-[var(--accent)]">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.actionItems.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Action items</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {notes.actionItems.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-[var(--accent)]">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.vocabulary.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Vocabulary taught</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {notes.vocabulary.map((word) => (
              <div key={word.de} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">{word.de}</p>
                <p className="text-xs text-[var(--muted)]">
                  {word.en}
                  {word.note ? ` — ${word.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {notes.corrections.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Corrections — private, just for you</h3>
          <div className="mt-2 space-y-2">
            {notes.corrections.map((item) => (
              <div key={item.mistake} className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-2">
                <p className="text-sm text-[var(--foreground)]">
                  <span className="text-[var(--muted)] line-through">{item.mistake}</span>
                  {" → "}
                  <span className="font-semibold">{item.correction}</span>
                </p>
                {item.note ? <p className="mt-0.5 text-xs text-[var(--muted)]">{item.note}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {notes.progressHighlights.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Progress this lesson</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {notes.progressHighlights.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-emerald-500">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {transcriptText ? (
        <div>
          <button
            onClick={() => setShowTranscript((value) => !value)}
            className="text-sm font-semibold text-[var(--accent)]"
          >
            {showTranscript ? "Hide full transcript" : "Show full transcript"}
          </button>
          {showTranscript ? (
            segments.length > 0 ? (
              <div className="mt-3 space-y-2">
                {speakerRanges.length > 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">
                    Tutor/{isPrivate ? "you" : "student"} labels are a best guess from phrasing, not a verified recording of who spoke — click a timestamp to jump there.
                  </p>
                ) : null}
                <div className="max-h-96 space-y-2.5 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                {segments.map((segment, index) => {
                  const speaker = speakerAt(index, speakerRanges);
                  return (
                    <button
                      key={`${segment.start}-${index}`}
                      onClick={() => onSeekTo?.(segment.start)}
                      disabled={!onSeekTo}
                      className="block w-full text-left disabled:cursor-default"
                    >
                      <span className="mr-2 inline-flex items-center gap-1.5">
                        <span
                          className={`font-mono text-[11px] ${onSeekTo ? "text-[var(--accent)] hover:underline" : "text-[var(--muted)]"}`}
                        >
                          {formatTimestamp(segment.start)}
                        </span>
                        {speaker ? (
                          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                            {SPEAKER_LABEL[speaker]}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs leading-6 text-[var(--muted)]">{segment.text}</span>
                    </button>
                  );
                })}
                </div>
              </div>
            ) : (
              <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-xs leading-6 text-[var(--muted)]">
                {transcriptText}
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
