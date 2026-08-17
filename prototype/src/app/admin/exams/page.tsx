"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import StatCard from "@/components/StatCard";
import { LEVELS } from "@/lib/levels";
import { ExamCentreIcon, UsersIcon, TrophyIcon, AlertIcon } from "@/components/icons";

/**
 * The one exam admin page.
 *
 * Replaces three earlier pages (`/admin/exams`, `/admin/exam-centre`,
 * `/admin/exam-registrations`) that duplicated each other — two of which
 * wrote registrations with no link to an `Exam` row at all, silently
 * skipping seat capacity, payment tracking and publish gating. This is the
 * only one that was ever correct, built out with per-skill results entry.
 */

const SKILLS = [
  { key: "reading", label: "Lesen (Reading)" },
  { key: "listening", label: "Hören (Listening)" },
  { key: "writing", label: "Schreiben (Writing)" },
  { key: "speaking", label: "Sprechen (Speaking)" },
] as const;
type SkillKey = (typeof SKILLS)[number]["key"];

type Grade = {
  studentId: string;
  score: number;
  grade: string | null;
  readingScore: number | null;
  listeningScore: number | null;
  writingScore: number | null;
  speakingScore: number | null;
};

type Registration = {
  id: string;
  studentId: string | null;
  seatNumber: string | null;
  status: string;
  paymentStatus: string;
  candidateName: string | null;
  candidateEmail: string | null;
  student: { studentCode: string | null; user: { name: string | null; email: string } } | null;
  grade: Grade | null;
};

type Exam = {
  id: string;
  name: string;
  examBody: string;
  level: string | null;
  examDate: string;
  registrationDeadline: string | null;
  fee: number | null;
  capacity: number | null;
  published: boolean;
  passThreshold: number;
  branch: { id: string; name: string } | null;
  registrations: Registration[];
  taken: number;
  remaining: number | null;
};

type Stats = {
  published: number;
  booked: number;
  noShows: number;
  passRate: number | null;
  avgReading: number | null;
  avgListening: number | null;
  avgWriting: number | null;
  avgSpeaking: number | null;
};

function isInternal(body: string) {
  return body === "internal";
}

export default function AdminExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [bodies, setBodies] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);
  const [scoreDrafts, setScoreDrafts] = useState<Record<SkillKey, string>>({
    reading: "", listening: "", writing: "", speaking: "",
  });

  const [form, setForm] = useState({
    name: "", description: "", examDate: "", registrationDeadline: "",
    examBody: "internal", level: "B1", branchId: "", fee: "", capacity: "", passThreshold: "60", published: true,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/exams", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load");
      setExams(data.exams ?? []);
      setBranches(data.branches ?? []);
      setBodies(data.bodies ?? []);
      setStats(data.stats ?? null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exams", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create");
      setOpen(false);
      setForm({ ...form, name: "", description: "", examDate: "", registrationDeadline: "", fee: "", capacity: "" });
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create");
    } finally { setBusy(false); }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exams", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update");
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally { setBusy(false); }
  }

  function startGrading(reg: Registration) {
    setGrading(reg.id);
    setScoreDrafts({
      reading: reg.grade?.readingScore?.toString() ?? "",
      listening: reg.grade?.listeningScore?.toString() ?? "",
      writing: reg.grade?.writingScore?.toString() ?? "",
      speaking: reg.grade?.speakingScore?.toString() ?? "",
    });
  }

  async function saveResults(registrationId: string) {
    const results: Record<string, number> = {};
    for (const { key } of SKILLS) {
      const n = Number(scoreDrafts[key]);
      if (!scoreDrafts[key] || Number.isNaN(n) || n < 0 || n > 100) {
        setError(`Enter every skill score as a number 0-100.`);
        return;
      }
      results[key] = n;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exams", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId, results }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save results");
      setGrading(null);
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save results");
    } finally { setBusy(false); }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Exams</h1>
            <p className="mt-1 text-sm text-slate-500">
              Schedule sittings, manage seats and enter results. Published internal sittings appear to students;
              ÖSD/telc sittings stay off student booking until the school switches that on.
            </p>
          </div>
          <button onClick={() => setOpen((v) => !v)} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
            {open ? "Cancel" : "New sitting"}
          </button>
        </div>

        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Published sittings" value={String(stats.published)} icon={<ExamCentreIcon />} />
            <StatCard label="Seats booked" value={String(stats.booked)} icon={<UsersIcon />} accent="bg-gradient-to-br from-blue-500 to-blue-700" />
            <StatCard
              label="Internal pass rate"
              value={stats.passRate === null ? "—" : `${stats.passRate}%`}
              icon={<TrophyIcon />}
              accent="bg-gradient-to-br from-emerald-500 to-emerald-700"
            />
            <StatCard label="No-shows" value={String(stats.noShows)} icon={<AlertIcon />} accent="bg-gradient-to-br from-amber-500 to-amber-700" />
          </div>
        )}

        {stats && stats.passRate !== null && (
          <p className="mb-6 text-xs text-slate-500">
            Skill averages (internal, graded sittings) — Lesen {stats.avgReading} · Hören {stats.avgListening} ·
            Schreiben {stats.avgWriting} · Sprechen {stats.avgSpeaking}
          </p>
        )}

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {open && (
          <div className="mb-8 grid gap-3 rounded-xl border bg-white p-6 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="EasyWay B1 end-of-level test" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Description</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Awarding body</span>
              <select value={form.examBody} onChange={(e) => setForm({ ...form, examBody: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                {bodies.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {!isInternal(form.examBody) && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  Hidden from student booking — ÖSD/telc booking isn't live yet.
                </span>
              )}
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Level</span>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Exam date</span>
              <input type="datetime-local" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Registration deadline</span>
              <input type="datetime-local" value={form.registrationDeadline} onChange={(e) => setForm({ ...form, registrationDeadline: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Fee (₦) — blank for none</span>
              <input type="number" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Seats — blank for unlimited</span>
              <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Pass threshold per skill (0-100)</span>
              <input type="number" value={form.passThreshold} onChange={(e) => setForm({ ...form, passThreshold: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-xs font-medium text-slate-600">Centre</span>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                <option value="">Any branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
              <span className="text-sm">Publish immediately</span>
            </label>
            <div className="sm:col-span-2">
              <button onClick={create} disabled={busy || !form.name.trim() || !form.examDate}
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "Creating…" : "Create sitting"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : exams.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No sittings scheduled.</div>
        ) : (
          <div className="space-y-3">
            {exams.map((exam) => (
              <div key={exam.id} className="rounded-xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{exam.examBody}</span>
                      {exam.level && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">{exam.level}</span>}
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${exam.published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {exam.published ? "PUBLISHED" : "DRAFT"}
                      </span>
                      {!isInternal(exam.examBody) && (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white">HIDDEN FROM STUDENTS</span>
                      )}
                    </div>
                    <h3 className="mt-1.5 font-semibold">{exam.name}</h3>
                    <p className="text-sm text-slate-500">
                      {new Date(exam.examDate).toDateString()}
                      {exam.branch && ` · ${exam.branch.name}`}
                      {exam.fee !== null && ` · ₦${exam.fee.toLocaleString()}`}
                      {isInternal(exam.examBody) && ` · pass ≥ ${exam.passThreshold}/skill`}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {exam.taken}{exam.capacity !== null && ` / ${exam.capacity}`} booked
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => patch({ examId: exam.id, published: !exam.published })} disabled={busy}
                        className="rounded border px-3 py-1 text-xs font-semibold">
                        {exam.published ? "Unpublish" : "Publish"}
                      </button>
                      <button onClick={() => setExpanded(expanded === exam.id ? null : exam.id)}
                        className="rounded border px-3 py-1 text-xs font-semibold">
                        {expanded === exam.id ? "Hide" : `Candidates (${exam.registrations.length})`}
                      </button>
                    </div>
                  </div>
                </div>

                {expanded === exam.id && (
                  <div className="mt-4 space-y-2 border-t pt-4">
                    {exam.registrations.length === 0 ? (
                      <p className="text-sm text-slate-500">Nobody has booked yet.</p>
                    ) : exam.registrations.map((r) => (
                      <div key={r.id} className="rounded bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {r.student?.user.name ?? r.candidateName ?? "—"}
                              {!r.student && (
                                <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">EXTERNAL</span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {r.student?.user.email ?? r.candidateEmail}
                              {r.seatNumber && ` · seat ${r.seatNumber}`}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${r.paymentStatus === "paid" ? "bg-emerald-100 text-emerald-700" : r.paymentStatus === "waived" ? "bg-slate-200 text-slate-600" : "bg-red-100 text-red-700"}`}>
                              {r.paymentStatus}
                            </span>
                            {r.paymentStatus === "unpaid" && (
                              <button onClick={() => patch({ registrationId: r.id, paymentStatus: "paid", status: "confirmed" })}
                                disabled={busy} className="rounded border px-2 py-1 text-xs font-semibold">
                                Mark paid
                              </button>
                            )}
                            {isInternal(exam.examBody) && r.studentId && r.status !== "cancelled" && (
                              <>
                                {r.grade ? (() => {
                                  const skills = [r.grade.readingScore, r.grade.listeningScore, r.grade.writingScore, r.grade.speakingScore];
                                  // Grades entered before per-skill scoring existed have a score but
                                  // no skill breakdown — showing FAILED for those would be inventing a
                                  // verdict this record was never given.
                                  const hasSkills = skills.every((s) => s !== null);
                                  const passed = hasSkills && skills.every((s) => (s as number) >= exam.passThreshold);
                                  return (
                                    <span
                                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                        !hasSkills
                                          ? "bg-slate-200 text-slate-600"
                                          : passed
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-red-100 text-red-700"
                                      }`}
                                    >
                                      {!hasSkills ? "GRADED" : passed ? "PASSED" : "FAILED"} · {r.grade.score}
                                    </span>
                                  );
                                })() : null}
                                <button onClick={() => startGrading(r)} className="rounded border px-2 py-1 text-xs font-semibold">
                                  {r.grade ? "Edit results" : "Enter results"}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {grading === r.id && (
                          <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4">
                            {SKILLS.map(({ key, label }) => (
                              <label key={key}>
                                <span className="text-[11px] font-medium text-slate-600">{label}</span>
                                <input
                                  type="number" min={0} max={100}
                                  value={scoreDrafts[key]}
                                  onChange={(e) => setScoreDrafts({ ...scoreDrafts, [key]: e.target.value })}
                                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                                />
                              </label>
                            ))}
                            <div className="flex items-end gap-2 sm:col-span-4">
                              <button onClick={() => saveResults(r.id)} disabled={busy}
                                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">
                                {busy ? "Saving…" : "Save results"}
                              </button>
                              <button onClick={() => setGrading(null)} className="rounded-lg border px-4 py-2 text-xs font-semibold">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {r.grade && grading !== r.id && r.grade.readingScore !== null && (
                          <p className="mt-2 text-[11px] text-slate-500">
                            Lesen {r.grade.readingScore} · Hören {r.grade.listeningScore} · Schreiben {r.grade.writingScore} · Sprechen {r.grade.speakingScore}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
