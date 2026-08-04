"use client";

import StudentShell from "@/components/StudentShell";
import SmartCalendarClient from "@/components/SmartCalendarClient";

// The tuition paywall lives in StudentShell, so this page no longer fetches the
// payment summary itself.
export default function CalendarPage() {
  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        {/* Padding steps up with the screen. At 375px the old px-6 + p-8 spent
            56px of a 375px screen on whitespace before the map got any. */}
        <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6 sm:py-10">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:rounded-[32px] sm:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)] sm:text-sm sm:tracking-[0.3em]">
                  Classes
                </p>
                <h1 className="mt-2 text-2xl font-semibold sm:mt-3 sm:text-3xl">Your upcoming schedule</h1>
              </div>
            </div>

            <div className="mt-6 sm:mt-10">
              <SmartCalendarClient />
            </div>
          </div>
        </div>
      </main>
    </StudentShell>
  );
}
