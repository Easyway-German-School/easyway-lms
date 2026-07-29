"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Next exams, on the dashboard.
 *
 * The point is that a booking made anywhere — the student portal, or the
 * public exam-centre page on the main website — shows up here, because both
 * write the same ExamRegistration rows. Renders nothing when there is nothing
 * booked rather than occupying the dashboard with an empty state.
 */

type MyExam = {
  registrationId: string;
  name: string;
  examBody: string | null;
  level: string | null;
  examDate: string;
  paymentStatus: string;
  fee: number | null;
  seatNumber: string | null;
  branchName: string | null;
};

const BODY_TONE: Record<string, string> = {
  "ÖSD": "bg-red-100 text-red-700",
  Goethe: "bg-blue-100 text-blue-700",
  telc: "bg-purple-100 text-purple-700",
  internal: "bg-slate-100 text-slate-700",
};

export default function UpcomingExamsCard() {
  const [exams, setExams] = useState<MyExam[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/my-exams", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setExams(data.upcoming ?? []);
      } catch {
        /* The dashboard should still render if this one call fails. */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || exams.length === 0) return null;

  return (
    <div className="cinematic-card rounded-[32px] p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Examinations</p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900">Coming up</h2>
        </div>
        <Link href="/exams" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
          All exams
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {exams.slice(0, 3).map((exam) => {
          const days = Math.ceil((new Date(exam.examDate).getTime() - Date.now()) / 86_400_000);
          return (
            <div key={exam.registrationId} className="flex items-center justify-between gap-4 rounded-[28px] border border-slate-200/70 bg-slate-50/80 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {exam.examBody && (
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${BODY_TONE[exam.examBody] ?? BODY_TONE.internal}`}>
                      {exam.examBody}
                    </span>
                  )}
                  {exam.level && <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">{exam.level}</span>}
                  {exam.paymentStatus === "unpaid" && exam.fee && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">FEE DUE</span>
                  )}
                </div>
                <p className="mt-2 truncate font-semibold text-slate-900">{exam.name}</p>
                <p className="text-sm text-slate-500">
                  {new Date(exam.examDate).toDateString()}
                  {exam.seatNumber && ` · seat ${exam.seatNumber}`}
                  {exam.branchName && ` · ${exam.branchName}`}
                </p>
              </div>
              <div className="shrink-0 rounded-2xl bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-2xl font-semibold text-slate-900">{days > 0 ? days : 0}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {days === 1 ? "day" : "days"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
