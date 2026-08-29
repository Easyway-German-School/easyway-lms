"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRightIcon, BookOpenIcon, CalendarIcon, SparklesIcon, VideoIcon } from "@/components/icons";

type Props = {
  classType?: string;
  deliveryMode?: string;
};

type ScheduleItem = { title?: string; start?: string; scheduledAt?: string; status?: string; topic?: string | null };
type Note = { summary: string; sessionTopic: string | null; sessionDate: string | null };

function dateLabel(value?: string | null) {
  if (!value) return "To be arranged";
  return new Date(value).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function DeliveryExperiencePanel({ classType, deliveryMode }: Props) {
  const isPrivate = classType === "private";
  const isOnline = !isPrivate && deliveryMode === "online";
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    if (!isPrivate) return;
    let alive = true;
    Promise.all([
      fetch("/api/schedule", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/student/session-notes", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ]).then(([scheduleData, notesData]) => {
      if (!alive) return;
      setSchedule(Array.isArray(scheduleData?.events) ? scheduleData.events.slice(0, 3) : Array.isArray(scheduleData?.schedule) ? scheduleData.schedule.slice(0, 3) : []);
      setNote(notesData?.notes?.[0] ?? null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [isPrivate]);

  if (!isPrivate && !isOnline) return null;

  if (isPrivate) {
    const next = schedule[0];
    return (
      <section className="mb-8 overflow-hidden rounded-[32px] border border-[#D4AF37]/30 bg-[radial-gradient(circle_at_15%_0%,_#292116_0%,_#0b0a09_60%,_#000000_100%)] p-6 text-white shadow-[0_28px_80px_-30px_rgba(212,175,55,0.5)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#E8C766]"><SparklesIcon className="h-4 w-4" /> Private coaching desk</p>
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">Your progress, personally directed.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Every session, correction, and practice task stays connected to your individual goal.</p>
          </div>
          <span className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-1 text-xs font-semibold text-[#F4E3B2]">Elite 1:1</span>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><CalendarIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-3 text-xs uppercase tracking-widest text-white/40">Next session</p><p className="mt-1 text-sm font-semibold">{dateLabel(next?.start ?? next?.scheduledAt)}</p><p className="mt-1 text-xs text-white/50">{next?.topic ?? next?.title ?? "Your tutor will confirm the focus"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><BookOpenIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-3 text-xs uppercase tracking-widest text-white/40">Latest tutor note</p><p className="mt-1 line-clamp-3 text-sm text-white/75">{note?.summary ?? "Your tutor's session summary will appear here."}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><SparklesIcon className="h-5 w-5 text-[#E8C766]" /><p className="mt-3 text-xs uppercase tracking-widest text-white/40">Private AI studio</p><p className="mt-1 text-sm font-semibold">8 essays · 30 speaking drills daily</p><p className="mt-1 text-xs text-white/50">More room to practise between sessions.</p></div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
          <Link href="/calendar" className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-[#1c1508]">Open schedule <ArrowRightIcon className="h-4 w-4" /></Link>
          <Link href="/essay" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-white/80">Open AI writing studio</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8 overflow-hidden rounded-[32px] border border-sky-300/30 bg-[linear-gradient(135deg,#082f49,#0f172a_62%,#164e63)] p-6 text-white shadow-[0_28px_80px_-30px_rgba(14,165,233,0.5)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200"><VideoIcon className="h-4 w-4" /> Online class control room</p><h2 className="mt-3 text-2xl font-bold sm:text-3xl">Never lose a lesson to a weak connection.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-sky-100/70">Your class links, recordings, and catch-up route stay together in one place.</p></div><span className="rounded-full border border-sky-200/25 bg-sky-200/10 px-3 py-1 text-xs font-semibold text-sky-100">Online access</span></div>
      <div className="mt-7 grid gap-4 sm:grid-cols-3"><Link href="/live" className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition hover:bg-white/10"><VideoIcon className="h-5 w-5 text-sky-200" /><p className="mt-3 text-sm font-semibold">Prepare for live class</p><p className="mt-1 text-xs text-sky-100/60">Check your setup and join when your tutor opens the room.</p></Link><Link href="/materials" className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition hover:bg-white/10"><BookOpenIcon className="h-5 w-5 text-sky-200" /><p className="mt-3 text-sm font-semibold">Catch up from recordings</p><p className="mt-1 text-xs text-sky-100/60">Open lesson materials when you miss or replay a class.</p></Link><Link href="/calendar" className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition hover:bg-white/10"><CalendarIcon className="h-5 w-5 text-sky-200" /><p className="mt-3 text-sm font-semibold">See your local time</p><p className="mt-1 text-xs text-sky-100/60">Your timetable stays anchored to your timezone.</p></Link></div>
    </section>
  );
}
