"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpenIcon, DownloadIcon, TrendingUpIcon, VideoIcon } from "@/components/icons";

type Report = { student: string; level: string; pathway: string; skills: Array<{ skill: string; average: number; attempts: number }>; attendance: { held: number; present: number; rate: number | null }; sessions: { completed: number; total: number; next: { scheduledAt: string; topic: string | null } | null }; notes: Array<{ summary: string; topic: string | null; date: string }>; focus: string };
type CatchUp = { missed: Array<{ date: string; status: string }>; recordings: Array<{ id: string; title: string; recordedAt: string }>; action: string | null; enabled: boolean };

function date(value: string) { return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }

export default function PremiumProgressPanel({ classType, deliveryMode }: { classType?: string; deliveryMode?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
  useEffect(() => {
    const url = classType === "private" ? "/api/student/premium-report" : deliveryMode === "online" ? "/api/student/catch-up" : null;
    if (!url) return;
    fetch(url, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => classType === "private" ? setReport(data) : setCatchUp(data)).catch(() => undefined);
  }, [classType, deliveryMode]);

  if (report) return (
    <section className="mb-8 rounded-[32px] border border-[#D4AF37]/25 bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_60%,_#000000_100%)] p-6 text-white sm:p-8 print:bg-white print:text-black">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#E8C766]">Private progress portfolio</p><h2 className="mt-2 text-2xl font-bold">{report.student}&apos;s coaching report</h2><p className="mt-1 text-sm text-white/55">{report.level} · {report.pathway} · Focus: {report.focus}</p></div><button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold"><DownloadIcon className="h-4 w-4" /> Download report</button></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><TrendingUpIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-2 text-xs text-white/45">Attendance</p><p className="text-2xl font-bold">{report.attendance.rate ?? "—"}%</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><BookOpenIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-2 text-xs text-white/45">Private sessions</p><p className="text-2xl font-bold">{report.sessions.completed}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><TrendingUpIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-2 text-xs text-white/45">Next focus</p><p className="text-sm font-semibold capitalize">{report.focus}</p></div></div>
      <div className="mt-6 grid gap-6 md:grid-cols-2"><div><h3 className="text-sm font-semibold text-[#F4E3B2]">Skill mastery</h3><div className="mt-3 space-y-3">{report.skills.slice(0, 6).map((skill) => <div key={skill.skill}><div className="flex justify-between text-sm"><span className="capitalize">{skill.skill}</span><strong>{skill.average}%</strong></div><div className="mt-1 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: `${skill.average}%` }} /></div></div>)}</div></div><div><h3 className="text-sm font-semibold text-[#F4E3B2]">Latest tutor summaries</h3><div className="mt-3 space-y-3">{report.notes.slice(0, 3).map((note, index) => <div key={`${note.date}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p className="text-xs text-white/45">{date(note.date)} · {note.topic ?? "Coaching session"}</p><p className="mt-1 text-sm text-white/75">{note.summary}</p></div>)}</div></div></div>
    </section>
  );

  if (!catchUp?.enabled || (!catchUp.missed.length && !catchUp.recordings.length)) return null;
  return <section className="mb-8 rounded-[32px] border border-sky-300/25 bg-[linear-gradient(135deg,#082f49,#0f172a)] p-6 text-white sm:p-8"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-sky-200"><VideoIcon className="h-4 w-4" /> Online catch-up desk</p><h2 className="mt-2 text-2xl font-bold">Your missed lesson route</h2><p className="mt-2 text-sm text-sky-100/65">{catchUp.action}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{catchUp.recordings.slice(0, 4).map((recording) => <Link key={recording.id} href={`/materials/watch/${recording.id}`} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 hover:bg-white/10"><p className="font-semibold">{recording.title}</p><p className="mt-1 text-xs text-sky-100/55">Recorded {date(recording.recordedAt)}</p></Link>)}</div></section>;
}
