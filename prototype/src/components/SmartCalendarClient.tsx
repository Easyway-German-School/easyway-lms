"use client";

import { useEffect, useState } from "react";

type Student = {
  name?: string;
  level?: string; // A1, A2, B1, B2
  pathway?: string;
  admission?: {
    batchStartMonth?: number;
    classApplied?: string;
    preferredExam?: string;
    branch?: string;
  };
};

function weekdayName(n: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][n];
}

function buildA1Schedule(seedMonth: number, year: number) {
  const out: Array<{ label: string; events: string[] }> = [];
  const monthCount = 2;

  for (let offset = 0; offset < monthCount; offset += 1) {
    const monthIndex = (seedMonth + offset) % 12;
    const currentYear = year + Math.floor((seedMonth + offset) / 12);
    const label = new Date(currentYear, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(currentYear, monthIndex + 1, 0).getDate();
    const events: string[] = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(currentYear, monthIndex, day);
      const dayName = weekdayName(date.getDay());
      const isClassDay = dayName === 'Mon' || dayName === 'Wed' || dayName === 'Fri';

      if (isClassDay) {
        const slot = dayName === 'Mon' ? 'Speaking Lab' : dayName === 'Wed' ? 'Grammar Lab' : 'Conversation Lab';
        events.push(`${dayName} · ${slot} · ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
      }
    }

    out.push({ label, events });
  }

  return out;
}

export default function SmartCalendarClient() {
  const [student, setStudent] = useState<Student | null>(null);
  const [months, setMonths] = useState<Array<{ label: string; events: string[] }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        // Try server-generated personalized plan first
        const res = await fetch('/api/schedule', { cache: 'no-store', credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (!mounted) return;
          if (data?.months) {
            setMonths(data.months.map((m: any) => ({ label: m.label, events: m.events.map((e: any) => e.title) }))); 
            setLoading(false);
            return;
          }
        }

        // Fallback: compute locally from /api/student
        const res2 = await fetch('/api/student', { cache: 'no-store', credentials: 'include' });
        if (!res2.ok) {
          if (mounted) setLoading(false);
          return;
        }

        const data = await res2.json();
        if (!mounted) return;
        setStudent(data);

        const now = new Date();
        const startMonth = typeof data?.admission?.batchStartMonth === 'number' ? data.admission.batchStartMonth : now.getMonth();
        const levelLabel = String(data?.level || data?.pathway || 'A1').toUpperCase();
        const out = buildA1Schedule(startMonth, now.getFullYear()).map((month) => ({
          ...month,
          events: month.events.map((event) => `${levelLabel} class · ${event}`),
        }));

        setMonths(out);
      } catch (err) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
        <p className="text-sm text-[var(--muted)]">Loading schedule…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {months.map((m) => (
        <div key={m.label} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6">
          <h2 className="text-xl font-semibold text-[var(--foreground)]">{m.label}</h2>
          <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {m.events.map((ev) => (
              <li key={ev} className="rounded-2xl bg-white/80 p-3 text-[var(--foreground)] shadow-sm">{ev}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
