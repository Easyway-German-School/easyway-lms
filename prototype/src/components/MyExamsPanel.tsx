"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Everything the signed-in person has booked — Easyway tests and ÖSD centre
 * sittings in one list — plus what they can still register for.
 *
 * Shared by the student portal and the candidate view, because the answer to
 * "what exams do I have coming up?" should not depend on which kind of account
 * is asking.
 */

type MyExam = {
  registrationId: string;
  examId: string | null;
  name: string;
  examBody: string | null;
  level: string | null;
  examDate: string;
  status: string;
  paymentStatus: string;
  fee: number | null;
  seatNumber: string | null;
  branchName: string | null;
  result: { score: number; grade: string | null; feedback: string | null } | null;
};

type Available = {
  id: string;
  name: string;
  examBody: string;
  level: string | null;
  examDate: string;
  fee: number | null;
  branch: { name: string } | null;
  capacity: number | null;
  remaining: number | null;
  full: boolean;
  deadlinePassed: boolean;
};

const BODY_TONE: Record<string, string> = {
  "ÖSD": "bg-red-100 text-red-700",
  Goethe: "bg-blue-100 text-blue-700",
  telc: "bg-purple-100 text-purple-700",
  internal: "bg-slate-100 text-slate-700",
};

function daysUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export default function MyExamsPanel() {
  const [upcoming, setUpcoming] = useState<MyExam[]>([]);
  const [past, setPast] = useState<MyExam[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/my-exams", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load your exams");
      setUpcoming(data.upcoming ?? []);
      setPast(data.past ?? []);
      setAvailable(data.available ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function book(examId: string) {
    setBusyId(examId);
    try {
      const res = await fetch("/api/exam-centre", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not register");
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register");
    } finally {
      setBusyId(null);
    }
  }

  async function payFee(registrationId: string) {
    setPayingId(registrationId);
    try {
      const res = await fetch("/api/exam-centre/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start payment");
      // Straight to Paystack; the seat is settled by the webhook regardless of
      // whether they make it back to the callback page.
      window.location.href = data.authorization_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment");
      setPayingId(null);
    }
  }

  if (loading) {
    return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-3xl bg-slate-200/60" />)}</div>;
  }

  return (
    <div className="space-y-8">
      {error && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <section>
        <h2 className="text-lg font-bold">Coming up</h2>
        {upcoming.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <div className="text-4xl">🗓️</div>
            <p className="mt-3 text-sm font-semibold">No exams booked</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Anything you register for appears here.</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {upcoming.map((e) => {
              const days = daysUntil(e.examDate);
              return (
                <div key={e.registrationId} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {e.examBody && (
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${BODY_TONE[e.examBody] ?? BODY_TONE.internal}`}>
                            {e.examBody}
                          </span>
                        )}
                        {e.level && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{e.level}</span>}
                        {e.paymentStatus === "unpaid" && e.fee && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">FEE DUE</span>
                        )}
                        {e.paymentStatus === "paid" && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">PAID</span>
                        )}
                      </div>
                      <h3 className="mt-2 font-semibold">{e.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {new Date(e.examDate).toDateString()}
                        {e.branchName && ` · ${e.branchName}`}
                        {e.seatNumber && ` · seat ${e.seatNumber}`}
                      </p>
                      {e.paymentStatus === "unpaid" && e.fee && (
                        <div className="mt-3">
                          <p className="text-xs text-red-600">
                            ₦{e.fee.toLocaleString()} payable — your seat is held once the fee is received.
                          </p>
                          <button
                            onClick={() => payFee(e.registrationId)}
                            disabled={payingId === e.registrationId}
                            className="mt-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {payingId === e.registrationId ? "Opening checkout…" : `Pay ₦${e.fee.toLocaleString()}`}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[var(--surface-alt)] px-4 py-3 text-center">
                      <p className="text-2xl font-bold">{days > 0 ? days : 0}</p>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        {days === 1 ? "day away" : "days away"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {available.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Open for registration</h2>
          <div className="mt-3 space-y-3">
            {available.map((e) => (
              <div key={e.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${BODY_TONE[e.examBody] ?? BODY_TONE.internal}`}>
                        {e.examBody}
                      </span>
                      {e.level && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{e.level}</span>}
                    </div>
                    <h3 className="mt-2 font-semibold">{e.name}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {new Date(e.examDate).toDateString()}
                      {e.branch && ` · ${e.branch.name}`}
                      {e.capacity !== null && ` · ${e.remaining} of ${e.capacity} seats left`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {e.fee !== null && <p className="text-lg font-bold">₦{e.fee.toLocaleString()}</p>}
                    <button
                      onClick={() => book(e.id)}
                      disabled={busyId === e.id || e.full || e.deadlinePassed}
                      className="mt-2 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {e.full ? "Full" : busyId === e.id ? "Booking…" : "Register"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Past exams</h2>
          <div className="mt-3 space-y-3">
            {past.map((e) => (
              <div key={e.registrationId} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{e.name}</h3>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {new Date(e.examDate).toDateString()}
                      {e.seatNumber && ` · seat ${e.seatNumber}`}
                    </p>
                    {e.result?.feedback && (
                      <p className="mt-2 text-sm text-[var(--muted)]">{e.result.feedback}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {e.result ? (
                      <>
                        <p className="text-2xl font-bold">{e.result.score}</p>
                        <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">score</p>
                      </>
                    ) : (
                      <p className="text-xs text-[var(--muted)]">Result pending</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
