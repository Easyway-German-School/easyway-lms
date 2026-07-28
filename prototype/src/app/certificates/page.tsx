"use client";

import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import StudentAccessGate from "@/components/StudentAccessGate";

export default function CertificatesPage() {
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
        // ignore
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
                  <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Certificates</p>
                  <h1 className="mt-3 text-3xl font-semibold">Your earned certificates</h1>
                </div>
                <div className="rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)]">
                  Verified credentials
                </div>
              </div>

              <div className="mt-10 grid gap-6 lg:grid-cols-3">
                {[
                  { title: "A1 German Completion", subtitle: "Passed with excellence", date: "May 2026" },
                  { title: "Goethe A2 Preparation", subtitle: "Course progress badge", date: "Pending" },
                  { title: "German Conversation", subtitle: "Attendance & participation", date: "April 2026" },
                ].map((cert) => (
                  <div key={cert.title} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Certificate</p>
                        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{cert.title}</h2>
                      </div>
                      <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                        {cert.date}
                      </span>
                    </div>
                    <p className="mt-4 text-sm text-[var(--muted)]">{cert.subtitle}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </StudentAccessGate>
    </StudentShell>
  );
}
