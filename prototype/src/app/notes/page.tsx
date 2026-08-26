"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import { PencilIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

type NoteRow = {
  materialId: string;
  title: string;
  isPrivate: boolean;
  level: string | null;
  updatedAt: string;
  preview: string;
};

/**
 * "My Notes" — the sidebar destination the editable notepad was missing.
 * The notepad itself lives on each video's Watch page (see MyNotesEditor);
 * this is just the index onto it — every note a student has actually
 * written something into, newest first. Without this, the only way to find
 * a note again was to remember which video it was under.
 */
export default function MyNotesPage() {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/student/notes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setNotes(data.notes ?? []))
      .catch(() => setError("Could not load your notes."));
  }, []);

  const body = (() => {
    if (error) {
      return <p className="text-sm text-red-600">{error}</p>;
    }
    if (!notes) {
      return <BrandLoader size="lg" title="Notizen werden geladen…" message="Loading your notes." />;
    }
    if (notes.length === 0) {
      return (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
          <PencilIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
          <p className="mt-3 text-base font-semibold text-[var(--foreground)]">Nothing here yet</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Open any class recording or lesson video in Materials and start writing — it saves as you type.
          </p>
          <Link
            href="/materials"
            className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
          >
            Go to Materials
          </Link>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {notes.map((note) => (
          <Link
            key={note.materialId}
            href={`/materials/watch/${note.materialId}`}
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-[var(--foreground)]">{note.title}</p>
              {note.isPrivate ? (
                <span className="rounded-full bg-gradient-to-r from-[#FF6600] to-[#FFC46B] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Private
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 whitespace-pre-line text-sm text-[var(--muted)]">{note.preview}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Last edited {new Date(note.updatedAt).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    );
  })();

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">My Notes</p>
            <h1 className="mt-2 text-2xl font-bold">Your notebook</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Everything you've written on a class or lesson, in one place.
            </p>
          </div>
          {body}
        </div>
      </div>
    </StudentShell>
  );
}
