"use client";

export const dynamic = "force-dynamic";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type ExamRegistration = {
  id: string;
  examName: string;
  examDate: string;
  level: string;
  branch?: string;
  status: "registered" | "completed" | "cancelled";
  fee?: number;
  score?: number;
  result?: string;
  certUrl?: string;
  registeredAt: string;
};

type AvailableExam = {
  id: string;
  examName: string;
  examDate: string;
  level: string;
  branch: string;
  fee: number;
  slotsLeft: number;
  deadline: string;
};

import StudentShell from "@/components/StudentShell";

export default function ExamsPage() {
  const { data: session } = useSession();
  const [registrations, setRegistrations] = useState<ExamRegistration[]>([]);
  const [availableExams, setAvailableExams] = useState<AvailableExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [activeTab, setActiveTab] = useState<"registered" | "available">("registered");
  const [examCategory, setExamCategory] = useState<"internal" | "osd">("internal");

  useEffect(() => {
    async function loadData() {
      try {
        const [regRes, examRes] = await Promise.all([
          fetch("/api/student/exam-registrations"),
          fetch("/api/student/available-exams"),
        ]);

        if (regRes.status === 401 || examRes.status === 401) {
          setError("Please log in to view exam information");
          setLoading(false);
          return;
        }

        if (!regRes.ok) throw new Error("Failed to load registrations");
        if (!examRes.ok) throw new Error("Failed to load available exams");

        const regData = await regRes.json();
        const examData = await examRes.json();

        setRegistrations(regData.registrations || []);
        setAvailableExams(examData.exams || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load exam data");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  async function handleRegisterExam(examId: string) {
    try {
      setRegistering(true);
      const res = await fetch("/api/student/exam-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId }),
      });

      if (!res.ok) throw new Error("Registration failed");

      const data = await res.json();
      setRegistrations([...registrations, data.registration]);
      setAvailableExams(availableExams.map((e) => e.id === examId ? { ...e, slotsLeft: e.slotsLeft - 1 } : e));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setRegistering(false);
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "registered":
        return <span className="inline-block rounded-full bg-orange-500/20 px-3 py-1 text-xs font-semibold text-orange-700">Registered</span>;
      case "completed":
        return <span className="inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-700">Completed</span>;
      case "cancelled":
        return <span className="inline-block rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-700">Cancelled</span>;
      default:
        return null;
    }
  };

  return (
    <StudentShell>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]"
      >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-xl ring-1 ring-white/10">
          <p className="text-sm uppercase tracking-[0.24em] text-[var(--accent)]">Exam center</p>
          <h1 className="mt-3 text-4xl font-bold">Exam Registration</h1>
          <p className="mt-2 text-[var(--muted)]">Register for exams and track your results</p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-2 py-3">
          <div className="flex gap-3">
            <button
              onClick={() => setActiveTab("registered")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "registered"
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              My registrations ({registrations.length})
            </button>
            <button
              onClick={() => setActiveTab("available")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "available"
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Available exams ({availableExams.length})
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[var(--muted)]">Exam category</label>
            <select
              value={examCategory}
              onChange={(event) => setExamCategory(event.target.value as "internal" | "osd")}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
            >
              <option value="internal">Internal Easyway exam</option>
              <option value="osd">OSD exam</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
            <p className="text-[var(--muted)]">Loading…</p>
          </div>
        ) : activeTab === "registered" ? (
          registrations.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
              <p className="text-lg font-semibold">No exam registrations yet</p>
              <p className="mt-2 text-[var(--muted)]">Browse available exams to register</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {registrations.map((reg) => (
                <motion.div
                  key={reg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-semibold">{reg.examName}</h3>
                        {statusBadge(reg.status)}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm text-[var(--muted)]">
                        <div>
                          <p className="text-xs">Level</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">{reg.level}</p>
                        </div>
                        <div>
                          <p className="text-xs">Date</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">{new Date(reg.examDate).toLocaleDateString()}</p>
                        </div>
                        {reg.score !== undefined && (
                          <div>
                            <p className="text-xs">Score</p>
                            <p className="mt-1 font-semibold text-[var(--foreground)]">{reg.score}%</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {reg.certUrl && (
                      <a
                        href={reg.certUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                      >
                        View certificate
                      </a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )
        ) : (
          availableExams.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
              <p className="text-lg font-semibold">No exams available</p>
              <p className="mt-2 text-[var(--muted)]">Check back later for new exam dates</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {availableExams
                .filter((exam) => {
                  const name = exam.examName.toLowerCase();
                  return examCategory === "osd"
                    ? name.includes("osd")
                    : !name.includes("osd");
                })
                .map((exam) => (
                  <motion.div
                    key={exam.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6"
                  >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold">{exam.examName}</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4 text-sm text-[var(--muted)]">
                        <div>
                          <p className="text-xs">Level</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">{exam.level}</p>
                        </div>
                        <div>
                          <p className="text-xs">Date</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">{new Date(exam.examDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-xs">Slots left</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">{exam.slotsLeft}</p>
                        </div>
                        <div>
                          <p className="text-xs">Fee</p>
                          <p className="mt-1 font-semibold text-[var(--foreground)]">₦{exam.fee.toLocaleString()}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Registration closes: {new Date(exam.deadline).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRegisterExam(exam.id)}
                      disabled={registering || exam.slotsLeft === 0}
                      className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
                    >
                      {exam.slotsLeft === 0 ? "Full" : "Register"}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        )}
      </div>
    </motion.div>
  </StudentShell>
  );
}
