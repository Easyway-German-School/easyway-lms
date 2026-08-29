"use client";

import { useEffect, useState } from "react";

/**
 * What each 1:1 actually covered, in the tutor's own words. This is the
 * tangible proof a private student (or whoever pays the invoice) can point
 * to — "we did this" — instead of a calendar row that just says a session
 * happened.
 */

type Note = {
  id: string;
  summary: string;
  tutorName: string;
  sessionTopic: string | null;
  sessionDate: string | null;
  createdAt: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function SessionNotesCard() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/student/session-notes", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setNotes(data.notes ?? []);
      } catch {
        // Quiet — this card just stays empty.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loaded && notes.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8C766]">Session notes</p>
      <div className="relative mt-4 space-y-3">
        {notes.slice(0, 3).map((note) => (
          <div key={note.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{note.sessionTopic || "Coaching session"}</p>
              <span className="shrink-0 text-xs text-white/40">{formatDate(note.sessionDate || note.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60">{note.summary}</p>
            <p className="mt-2 text-xs text-white/30">— {note.tutorName}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
