"use client";

export const dynamic = "force-dynamic";

import LecturerShell from "@/components/LecturerShell";
import { UsersIcon } from "@/components/icons";
import LecturerStudentRoster from "@/components/LecturerStudentRoster";

/**
 * My students.
 *
 * Tutors previously had no way to see who was in their class — the attendance
 * page looked them up through Enrollment, which almost nobody has rows in, so
 * a full class rendered as "No students enrolled". This reads the same
 * branch + level + sitting grouping the rest of the school runs on, so a
 * student appears here the moment they register. Nobody has to add them.
 */
export default function LecturerStudentsPage() {
  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-6xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]"><UsersIcon className="h-7 w-7 text-[var(--accent)]" />My students</h1>
            <p className="mt-2 text-[var(--muted)]">
              Everyone registered for the class you teach, with the same detail the office sees.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-6xl p-6">
          <LecturerStudentRoster />
        </div>
      </div>
    </LecturerShell>
  );
}
