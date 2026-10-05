"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import StudentShell from "@/components/StudentShell";
import {
  AssignmentIcon,
  AttendanceIcon,
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  CertificateIcon,
  ChainIcon,
  ExamCentreIcon,
  LockIcon,
  PaymentIcon,
  PencilIcon,
  PlayIcon,
  QuizIcon,
  ResultsIcon,
} from "@/components/icons";
import { isPhotoGatedRoute, isTuitionGatedRoute } from "@/lib/access";
import { useStudentAccess } from "@/lib/useStudentAccess";

/**
 * Everything the old sidebar listed, as one screen of big tiles.
 *
 * On a phone the sidebar was a drawer behind a hamburger holding seventeen
 * equal rows; a student hunting for "where do I hand in homework" had to open
 * it, scroll it and read it. Here the same places are grouped by what the
 * student is trying to do, each one a thumb-sized target, reached from the
 * bottom bar's Learn tab. The routes and their paywall / photo gates are
 * untouched — this is another door onto the same rooms.
 */

type Tile = { label: string; hint: string; href: string; icon: ReactNode; tint: string };
type Section = { title: string; tiles: Tile[] };

const SECTIONS: Section[] = [
  {
    title: "Study",
    tiles: [
      { label: "Materials", hint: "Videos, PDFs and slides", href: "/materials", icon: <BookOpenIcon className="h-6 w-6" />, tint: "#0D7C7E" },
      { label: "My notes", hint: "Recaps and your notebook", href: "/notes", icon: <PencilIcon className="h-6 w-6" />, tint: "#7C5CFF" },
      { label: "Tutorials", hint: "How to use the app", href: "/tutorials", icon: <PlayIcon className="h-6 w-6" />, tint: "#E8556D" },
      { label: "AI coach and games", hint: "Practise with Becca", href: "/games", icon: <ChainIcon className="h-6 w-6" />, tint: "#FF6600" },
    ],
  },
  {
    title: "Do",
    tiles: [
      { label: "Assignments", hint: "Hand in your work", href: "/assignment", icon: <AssignmentIcon className="h-6 w-6" />, tint: "#3B82F6" },
      { label: "Quiz game", hint: "Play in class", href: "/play", icon: <QuizIcon className="h-6 w-6" />, tint: "#F5B82E" },
      { label: "Classes", hint: "Your timetable", href: "/calendar", icon: <CalendarIcon className="h-6 w-6" />, tint: "#2BB673" },
      { label: "Exam centre", hint: "Book and prepare", href: "/exam-centre", icon: <ExamCentreIcon className="h-6 w-6" />, tint: "#8B5CF6" },
    ],
  },
  {
    title: "Progress",
    tiles: [
      { label: "Results", hint: "Grades and feedback", href: "/results", icon: <ResultsIcon className="h-6 w-6" />, tint: "#0D7C7E" },
      { label: "Attendance", hint: "Classes you have made", href: "/attendance", icon: <AttendanceIcon className="h-6 w-6" />, tint: "#2BB673" },
      { label: "Certificates", hint: "What you have earned", href: "/certificates", icon: <CertificateIcon className="h-6 w-6" />, tint: "#F5B82E" },
    ],
  },
  {
    title: "Account",
    tiles: [
      { label: "Notifications", hint: "Everything from the school", href: "/notifications", icon: <BellIcon className="h-6 w-6" />, tint: "#E8556D" },
      { label: "Payments", hint: "Fees and receipts", href: "/payments", icon: <PaymentIcon className="h-6 w-6" />, tint: "#3B82F6" },
    ],
  },
];

export default function LearnPage() {
  const { access, hasAccess } = useStudentAccess();

  return (
    <StudentShell>
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Learn</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Everything for your German, in one place.</p>

        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-6">
            <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">{section.title}</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {section.tiles.map((tile) => {
                // Same rule as the sidebar: locked tiles stay tappable, because
                // meeting the padlock explains the paywall better than a dead tile.
                const locked =
                  (!hasAccess && isTuitionGatedRoute(tile.href)) ||
                  (access !== null && access.hasPhoto === false && isPhotoGatedRoute(tile.href));
                return (
                  <Link
                    key={tile.href}
                    href={tile.href}
                    className="group relative flex min-h-[7.5rem] flex-col justify-between rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 transition active:scale-[0.97]"
                  >
                    <span
                      className="grid h-11 w-11 place-items-center rounded-2xl text-white"
                      style={{ background: tile.tint }}
                    >
                      {tile.icon}
                    </span>
                    <span>
                      <span className="block text-[15px] font-bold leading-tight text-[var(--foreground)]">{tile.label}</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">{tile.hint}</span>
                    </span>
                    {locked && <LockIcon className="absolute right-3 top-3 h-4 w-4 text-[var(--accent)]/70" strokeWidth={2.2} />}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </StudentShell>
  );
}
