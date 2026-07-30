"use client";

import StudentShell from "@/components/StudentShell";
import SmartCalendarClient from "@/components/SmartCalendarClient";

// The tuition paywall lives in StudentShell, so this page no longer fetches the
// payment summary itself.
export default function CalendarPage() {
  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Classes</p>
                <h1 className="mt-3 text-3xl font-semibold">Your upcoming schedule</h1>
              </div>
            </div>

            <div className="mt-10">
              <SmartCalendarClient />
            </div>
          </div>
        </div>
      </main>
    </StudentShell>
  );
}
