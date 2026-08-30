"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import { PencilIcon, BookOpenIcon, FilmIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

type StudyRow = {
  materialId: string;
  title: string;
  level: string | null;
  overviewPreview: string;
  sectionCount: number;
  vocabularyCount: number;
};
type RecapRow = {
  materialId: string;
  title: string;
  level: string | null;
  isPrivate: boolean;
  videoExpired: boolean;
  preview: string;
};
type NoteRow = {
  materialId: string;
  title: string;
  kind: string;
  isPrivate: boolean;
  level: string | null;
  updatedAt: string;
  preview: string;
};

function PrivateTag() {
  return (
    <span className="rounded-full bg-gradient-to-r from-[#FF6600] to-[#FFC46B] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
      Private
    </span>
  );
}

export default function MyNotesPage() {
  const [study, setStudy] = useState<StudyRow[] | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [recaps, setRecaps] = useState<RecapRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/student/study-notes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/student/notes", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([studyData, notesData]) => {
        setStudy(studyData.notes ?? []);
        setPreparing(studyData.preparing ?? 0);
        setRecaps(notesData.recaps ?? []);
        setNotes(notesData.notes ?? []);
      })
      .catch(() => setError("Could not load your notes."));
  }, []);

  const loading = study === null && !error;
  const everythingEmpty =
    !loading && !error && (study?.length ?? 0) === 0 && recaps.length === 0 && notes.length === 0 && preparing === 0;

  const noteHref = (row: NoteRow) =>
    row.kind === "recording"
      ? `/notes/class/${row.materialId}`
      : row.kind === "document"
        ? `/notes/material/${row.materialId}`
        : `/materials/watch/${row.materialId}`;

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
        <div className="mx-auto max-w-3xl space-y-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">My Notes</p>
            <h1 className="mt-2 text-2xl font-bold">Your notebook</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Ready-made notes from your tutors&rsquo; materials, a recap of every class you attended, and everything
              you have written yourself — in one place.
            </p>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {loading ? <BrandLoader size="lg" title="Notizen werden geladen…" message="Loading your notes." /> : null}

          {everythingEmpty ? (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
              <PencilIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
              <p className="mt-3 text-base font-semibold">Nothing here yet</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Notes appear here as your tutors upload materials and your classes are recorded. You can also open any
                video in Materials and start writing.
              </p>
              <Link
                href="/materials"
                className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
              >
                Go to Materials
              </Link>
            </div>
          ) : null}

          {/* 1 — Ready-made notes from tutor documents */}
          {!loading && !error && (study!.length > 0 || preparing > 0) ? (
            <section className="space-y-3">
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
                <BookOpenIcon className="h-5 w-5 text-[var(--accent)]" /> Ready-made notes
              </h2>
              {preparing > 0 ? (
                <p className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
                  Becca is still writing up {preparing} of your tutors&rsquo; material{preparing === 1 ? "" : "s"} —
                  they appear here once your tutor has checked them.
                </p>
              ) : null}
              {study!.map((row) => (
                <Link
                  key={row.materialId}
                  href={`/notes/material/${row.materialId}`}
                  className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/40"
                >
                  <p className="font-semibold">{row.title}</p>
                  <p className="mt-1.5 text-sm text-[var(--muted)]">{row.overviewPreview}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {[row.level, `${row.sectionCount} section${row.sectionCount === 1 ? "" : "s"}`, row.vocabularyCount ? `${row.vocabularyCount} words` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </Link>
              ))}
            </section>
          ) : null}

          {/* 2 — Class recaps (survive the video's 2-week window) */}
          {!loading && !error && recaps.length > 0 ? (
            <section className="space-y-3">
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
                <FilmIcon className="h-5 w-5 text-[var(--accent)]" /> Class recaps
              </h2>
              {recaps.map((row) => (
                <Link
                  key={row.materialId}
                  href={`/notes/class/${row.materialId}`}
                  className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{row.title}</p>
                    {row.isPrivate ? <PrivateTag /> : null}
                    {row.videoExpired ? (
                      <span className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                        Video expired
                      </span>
                    ) : null}
                  </div>
                  {row.preview ? <p className="mt-1.5 text-sm text-[var(--muted)]">{row.preview}</p> : null}
                  {row.level ? <p className="mt-2 text-xs text-[var(--muted)]">{row.level}</p> : null}
                </Link>
              ))}
            </section>
          ) : null}

          {/* 3 — The student's own writing */}
          {!loading && !error && notes.length > 0 ? (
            <section className="space-y-3">
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold">
                <PencilIcon className="h-5 w-5 text-[var(--accent)]" /> Your notebook
              </h2>
              {notes.map((note) => (
                <Link
                  key={note.materialId}
                  href={noteHref(note)}
                  className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{note.title}</p>
                    {note.isPrivate ? <PrivateTag /> : null}
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-sm text-[var(--muted)]">{note.preview}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Last edited {new Date(note.updatedAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </StudentShell>
  );
}
