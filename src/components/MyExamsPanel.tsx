"use client";
import { CalendarIcon } from "@/components/icons";

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
  internal: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
};

/**
 * The two things a student is sitting, kept apart.
 *
 * An EasyWay student has two completely different kinds of exam in front of
 * them: the school's own end-of-level tests, and the ÖSD sitting that decides
 * whether they get a visa. One list mixing them meant scanning past four
 * classroom quizzes to find the date that actually matters. These are the two
 * labels the school asked for, and each one is a filter over the same booked
 * list rather than a separate page that could disagree with it.
 */
type ExamFilter = "all" | "easyway" | "osd";

const FILTER_LABELS: Record<ExamFilter, string> = {
  all: "All exams",
  easyway: "EasyWay exams",
  osd: "ÖSD exam",
};

/** Internal tests are EasyWay's; anything with an awarding body is external. */
function isEasywayExam(body: string | null | undefined): boolean {
  const value = String(body ?? "internal").toLowerCase();
  return value === "internal" || value === "easyway";
}

function matchesFilter(filter: ExamFilter, body: string | null | undefined): boolean {
  if (filter === "all") return true;
  return filter === "easyway" ? isEasywayExam(body) : !isEasywayExam(body);
}

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
  const [filter, setFilter] = useState<ExamFilter>("all");

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

  const shownUpcoming = upcoming.filter((exam) => matchesFilter(filter, exam.examBody));
  const shownPast = past.filter((exam) => matchesFilter(filter, exam.examBody));
  const shownAvailable = available.filter((exam) => matchesFilter(filter, exam.examBody));

  const counts: Record<ExamFilter, number> = {
    all: upcoming.length,
    easyway: upcoming.filter((exam) => isEasywayExam(exam.examBody)).length,
    osd: upcoming.filter((exam) => !isEasywayExam(exam.examBody)).length,
  };

  return (
    <div className="space-y-8">
      {error && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {/* Two labels, as the school asked for, plus the combined view they both
          came from — so nobody has to guess which tab a booking landed in. */}
      <div className="inline-flex flex-wrap gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
        {(["all", "easyway", "osd"] as ExamFilter[]).map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              filter === option
                ? "bg-[var(--accent)] text-white shadow"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {FILTER_LABELS[option]}
            {counts[option] > 0 ? (
              <span className={`ml-2 text-xs ${filter === option ? "text-white/80" : "text-[var(--muted)]"}`}>
                {counts[option]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-bold">Coming up</h2>
        {shownUpcoming.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <CalendarIcon className="mx-auto h-10 w-10 text-[var(--muted)]" />
            <p className="mt-3 text-sm font-semibold">
              {filter === "all" ? "No exams booked" : `No ${FILTER_LABELS[filter].toLowerCase()} booked`}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {filter === "easyway"
                ? "Your tutor's end-of-level tests appear here once the office schedules them."
                : filter === "osd"
                  ? "ÖSD sittings you register for appear here, with your seat number."
                  : "Anything you register for appears here."}
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {shownUpcoming.map((e) => {
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
                        {e.level && <span className="rounded bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-bold">{e.level}</span>}
                        {e.paymentStatus === "unpaid" && e.fee && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">FEE DUE</span>
                        )}
                        {e.paymentStatus === "paid" && (
                          <span className="rounded bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">PAID</span>
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

      {shownAvailable.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Open for registration</h2>
          <div className="mt-3 space-y-3">
            {shownAvailable.map((e) => (
              <div key={e.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${BODY_TONE[e.examBody] ?? BODY_TONE.internal}`}>
                        {e.examBody}
                      </span>
                      {e.level && <span className="rounded bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-bold">{e.level}</span>}
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

      {shownPast.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Past exams</h2>
          <div className="mt-3 space-y-3">
            {shownPast.map((e) => (
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
