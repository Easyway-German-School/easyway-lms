"use client";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import StudentAccessGate from "@/components/StudentAccessGate";
import SmartCalendarClient from "@/components/SmartCalendarClient";

export default function CalendarPage() {
  const [paymentReady, setPaymentReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/student", { credentials: "include" });
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          const hasAccess = Boolean(data?.paymentSummary?.depositPaid || data?.paymentSummary?.fullPaid);
          setPaymentReady(hasAccess);
        }
      } catch {
        // ignore and keep locked state
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <StudentShell>
      <StudentAccessGate hasAccess={paymentReady} loading={loading}>
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
      </StudentAccessGate>
    </StudentShell>
  );
}
