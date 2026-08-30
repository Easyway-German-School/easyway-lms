"use client";

export const dynamic = "force-dynamic";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import MyNotesEditor from "@/components/video/MyNotesEditor";
import StudyNoteView from "@/components/notes/StudyNoteView";
import DownloadNoteButton from "@/components/notes/DownloadNoteButton";
import { ArrowLeftIcon } from "@/components/icons";
import type { StudyNote } from "@/lib/material-ai";

type Payload = {
  materialId: string;
  title: string;
  level: string | null;
  courseTitle: string | null;
  summary: string | null;
  note: StudyNote;
  updatedAt: string | null;
};

export default function StudyNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/student/study-notes/${id}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "not-found" : "load");
        return res.json();
      })
      .then((body) => setData(body))
      .catch((err) => setError(err.message === "not-found" ? "not-found" : "load"));
  }, [id]);

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
        <div className="mx-auto max-w-2xl space-y-6">
          <Link
            href="/notes"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon /> My Notes
          </Link>

          {error === "not-found" ? (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
              <p className="text-base font-semibold">These notes are not ready yet</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Becca writes these up from your tutor&rsquo;s material once the tutor has checked them. Check back soon.
              </p>
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">Could not load these notes.</p>
          ) : !data ? (
            <BrandLoader size="lg" title="Notizen werden geladen…" message="Loading your notes." />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Ready-made note</p>
                  <h1 className="mt-2 text-2xl font-bold">{data.title}</h1>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {[data.courseTitle, data.level].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <DownloadNoteButton kind="study" materialId={data.materialId} title={data.title} payload={data.note} />
              </div>

              <p className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
                Written up from your tutor&rsquo;s uploaded material and checked by your tutor. Read it against the
                original in Materials.
              </p>

              <StudyNoteView note={data.note} />

              <div>
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Your own notes</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Anything you write here also shows under &ldquo;Your notebook&rdquo; in My Notes.
                </p>
                <div className="mt-3">
                  <MyNotesEditor materialId={id} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </StudentShell>
  );
}
