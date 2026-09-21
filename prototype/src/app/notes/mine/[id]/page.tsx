"use client";

import { use } from "react";
import StudentShell from "@/components/StudentShell";
import OwnNoteEditor from "@/components/notes/OwnNoteEditor";

export const dynamic = "force-dynamic";

/** One of the student's own notes — the page behind the "+" on My Notes. */
export default function OwnNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6 sm:py-10">
        <div className="mx-auto max-w-3xl">
          <OwnNoteEditor noteId={id} />
        </div>
      </div>
    </StudentShell>
  );
}
