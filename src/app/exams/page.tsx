"use client";

export const dynamic = "force-dynamic";

import StudentShell from "@/components/StudentShell";
import MyExamsPanel from "@/components/MyExamsPanel";

/**
 * The student's exams: internal Easyway tests and ÖSD centre sittings in one
 * list, with whatever is still open for registration underneath.
 *
 * Replaces a page that read /api/student/available-exams — which listed every
 * exam regardless of the published flag, so unpublished drafts were visible to
 * students, and booked through a path with no capacity check, so a sitting
 * could be oversold. Both now go through the exam centre.
 *
 * Deliberately not gated on payment: an exam booking is how the school gets
 * paid, so locking a student out of it would be self-defeating.
 */
export default function ExamsPage() {
  return (
    <StudentShell>
      <div className="px-6 py-8">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            Examinations
          </p>
          <h1 className="mt-2 text-3xl font-bold">Your exams</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Easyway tests and ÖSD sittings you have booked, and what is still open.
          </p>
        </div>

        <MyExamsPanel />
      </div>
    </StudentShell>
  );
}
