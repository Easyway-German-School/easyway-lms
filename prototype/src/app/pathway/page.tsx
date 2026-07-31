"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const programs: Record<string, { title: string; headline: string; details: string; stats: string[]; modules: string[] }> = {
  "Goethe exam mastery": {
    title: "Goethe Exam Mastery",
    headline: "A full Goethe preparation pathway for A1–C1 exam success.",
    details: "This pathway includes structured writing practice, speaking drills, mock exams, and AI-backed feedback tailored to Goethe scoring.",
    stats: ["Mock exams every week", "AI essay scoring", "Pronunciation drills", "Live exam strategy sessions"],
    modules: ["Mock B2 essay simulation", "Pronunciation lab", "Grammar drill set", "Exam vocabulary workshop"],
  },
  "Nursing career path": {
    title: "Nursing Career Path",
    headline: "German for healthcare roles in Germany with patient communication and hospital vocabulary.",
    details: "Designed for nursing aspirants, this track prepares you for medical interviews, documentation, and workplace German.",
    stats: ["Medical roleplay", "Patient notes in German", "Job interview training", "Visa readiness prep"],
    modules: ["Patient intake dialogue", "Medical phrasebook review", "Nursing scenario roleplay", "Healthcare grammar focus"],
  },
  "IT relocation track": {
    title: "IT Relocation Track",
    headline: "German for tech professionals: CVs, interviews, and workplace communication.",
    details: "This track equips you with German for software interviews, team collaboration, and relocation support.",
    stats: ["CV and cover letter coaching", "Technical roleplay", "Workplace vocabulary", "Interview prep"],
    modules: ["German tech interview practice", "Professional email writing", "Team meeting vocabulary", "Job application module"],
  },
  "Ausbildung & Vocational Route": {
    title: "Ausbildung & Vocational Route",
    headline: "Apprenticeship-focused German training for vocational admissions.",
    details: "This track supports applications for Ausbildung, trade-specific vocabulary, and workplace introductions.",
    stats: ["Application simulation", "Company interview prep", "Trade vocabulary", "Live apprenticeship sessions"],
    modules: ["Ausbildung application prep", "Vocational German drill", "Employer interview roleplay", "Practical worksite phrases"],
  },
};

function PathwayContent() {
  const searchParams = useSearchParams();
  const pathway = searchParams.get("pathway") || "Goethe exam mastery";
  const program = programs[pathway] || programs["Goethe exam mastery"];

  return (
    <div className="min-h-screen bg-[var(--surface-alt)] py-10 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Pathway details</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{program.title}</h1>
          <p className="mt-4 text-[var(--muted)]">{program.headline}</p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-950">What this path delivers</h2>
            <p className="mt-4 text-[var(--muted)]">{program.details}</p>
            <div className="mt-6 space-y-4">
              {program.stats.map((stat) => (
                <div key={stat} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                  <p className="text-sm text-[var(--muted)]">Feature</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{stat}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-3xl bg-slate-950 p-8 text-slate-50 shadow-xl">
            <h2 className="text-2xl font-semibold">Learning modules</h2>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-300">
              {program.modules.map((module) => (
                <li key={module} className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span>{module}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-3xl bg-slate-900 p-5 text-slate-300">
              <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">What makes this advanced</p>
              <p className="mt-3 text-sm leading-7">
                We keep the student view minimal: one pathway, one next step, one clean progress card. Behind the scenes, the platform adapts content, live sessions, and AI scoring to that pathway.
              </p>
            </div>
          </aside>
        </section>

        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <Link href="/" className="inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * useSearchParams opts the tree out of prerendering unless it sits inside a
 * Suspense boundary, so the page shell can still be generated at build time.
 */
export default function PathwayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-alt)] py-10" />}>
      <PathwayContent />
    </Suspense>
  );
}
