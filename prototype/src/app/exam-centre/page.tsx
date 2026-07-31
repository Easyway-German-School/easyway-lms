"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { CalendarIcon } from "@/components/icons";

/**
 * Public ÖSD exam centre.
 *
 * No sign-in wall: the centre sits members of the public, and a signed-in
 * student simply gets their details prefilled and the form collapsed.
 */

type Exam = {
  id: string;
  name: string;
  description: string | null;
  examBody: string;
  level: string | null;
  examDate: string;
  registrationDeadline: string | null;
  fee: number | null;
  branch: { id: string; name: string } | null;
  capacity: number | null;
  taken: number;
  remaining: number | null;
  full: boolean;
  deadlinePassed: boolean;
};

type Me = { studentId: string; name: string | null; email: string | null; level: string; studentCode: string | null };

const BODY_TONE: Record<string, string> = {
  "ÖSD": "bg-red-100 text-red-700",
  Goethe: "bg-blue-100 text-blue-700",
  telc: "bg-purple-100 text-purple-700",
  internal: "bg-slate-100 text-slate-700",
};

export default function ExamCentrePage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ seatNumber: string; fee: number | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exam-centre", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load exam sittings");
      setExams(data.exams ?? []);
      setMe(data.me ?? null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function register(exam: Exam) {
    setBusy(true);
    try {
      const res = await fetch("/api/exam-centre", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          me
            ? { examId: exam.id }
            : { examId: exam.id, candidateName: name, candidateEmail: email, candidatePhone: phone },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not register");

      setConfirmation({ seatNumber: data.seatNumber, fee: data.fee });
      setOpenId(null);
      setName(""); setEmail(""); setPhone("");
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#f7faff_0%,_#fffbf8_100%)]">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <BrandLogo variant="wordmark" className="h-10" />

        <div className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Examination centre</p>
          <h1 className="mt-2 text-4xl font-bold">Book your German exam</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Easyway is an accredited examination centre. You do not need to be a student here to sit an
            exam with us — anyone may register for a seat.
          </p>
        </div>

        {confirmation && (
          <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-sm font-bold text-emerald-800">Seat confirmed</p>
            <p className="mt-2 text-sm text-emerald-700">
              Your seat number is <span className="font-mono font-bold">{confirmation.seatNumber}</span>.
              {confirmation.fee
                ? ` A fee of ₦${confirmation.fee.toLocaleString()} is payable to hold it.`
                : " No fee is payable."}
            </p>
            <p className="mt-2 text-xs text-emerald-700">A confirmation email is on its way.</p>
          </div>
        )}

        {error && <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        {me && (
          <p className="mt-6 rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
            Signed in as <span className="font-semibold">{me.name}</span>
            {me.studentCode && <span className="ml-2 font-mono text-xs text-slate-400">{me.studentCode}</span>}
            {" "}— your details will be used automatically.
          </p>
        )}

        <div className="mt-8 space-y-4">
          {loading ? (
            [0, 1].map((i) => <div key={i} className="h-32 animate-pulse rounded-3xl bg-white/70" />)
          ) : exams.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <CalendarIcon className="mx-auto h-10 w-10 text-slate-400" />
              <p className="mt-3 text-sm font-semibold">No sittings open right now</p>
              <p className="mt-1 text-sm text-slate-500">
                New exam dates are published here as soon as they are scheduled.
              </p>
            </div>
          ) : (
            exams.map((exam) => {
              const closed = exam.full || exam.deadlinePassed;
              return (
                <div key={exam.id} className="rounded-3xl bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${BODY_TONE[exam.examBody] ?? BODY_TONE.internal}`}>
                          {exam.examBody}
                        </span>
                        {exam.level && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{exam.level}</span>
                        )}
                        {exam.full && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">FULL</span>
                        )}
                        {exam.deadlinePassed && !exam.full && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            REGISTRATION CLOSED
                          </span>
                        )}
                      </div>

                      <h2 className="mt-2 text-lg font-bold">{exam.name}</h2>
                      {exam.description && <p className="mt-1 text-sm text-slate-600">{exam.description}</p>}

                      <p className="mt-2 text-sm text-slate-500">
                        {new Date(exam.examDate).toDateString()}
                        {exam.branch && ` · ${exam.branch.name}`}
                        {exam.registrationDeadline &&
                          ` · register by ${new Date(exam.registrationDeadline).toLocaleDateString()}`}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {exam.fee !== null && (
                        <p className="text-2xl font-bold">₦{exam.fee.toLocaleString()}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {exam.capacity === null
                          ? "Unlimited seats"
                          : `${exam.remaining} of ${exam.capacity} seats left`}
                      </p>
                      <button
                        onClick={() => setOpenId(openId === exam.id ? null : exam.id)}
                        disabled={closed}
                        className="mt-3 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {closed ? "Unavailable" : openId === exam.id ? "Close" : "Register"}
                      </button>
                    </div>
                  </div>

                  {openId === exam.id && !closed && (
                    <div className="mt-5 border-t pt-5">
                      {me ? (
                        <p className="text-sm text-slate-600">
                          Registering as <span className="font-semibold">{me.name}</span> ({me.email}).
                        </p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
                            className="rounded-xl border px-3 py-2 text-sm" />
                          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email"
                            className="rounded-xl border px-3 py-2 text-sm" />
                          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)"
                            className="rounded-xl border px-3 py-2 text-sm" />
                        </div>
                      )}

                      <button
                        onClick={() => register(exam)}
                        disabled={busy || (!me && (!name.trim() || !email.trim()))}
                        className="mt-4 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {busy ? "Booking…" : "Confirm registration"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
