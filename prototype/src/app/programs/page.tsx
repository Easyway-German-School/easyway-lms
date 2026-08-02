"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import TuitionCheckout from "@/components/TuitionCheckout";

/**
 * The tuition checkout.
 *
 * Programs used to carry their own prices (Goethe ₦150k, Nursing ₦180k …) while
 * the paywall computed the fee from the student's LEVEL. The two disagreed: a
 * student on A1 could buy the ₦200,000 Ausbildung track and still be short of
 * the A1 deposit, or pay ₦180,000 against a ₦150,000 obligation. A pathway is
 * what you study; the level and branch are what you pay for. Prices now live
 * only in `src/lib/payment.ts` and reach this page through
 * `/api/student/tuition-offer`.
 */

const programs = [
  {
    title: "Certified Exam Mastery",
    // The display title above changed; this key deliberately did not. It is the
    // value stored on Student.pathway for everyone already enrolled, so
    // renaming it would orphan their records.
    pathwayName: "Language training",
    description: "Targeted A1–C1 exam training with structured writing, speaking, and mock evaluation.",
    benefits: ["Exam-level feedback", "Grammar drills", "Mock exam score tracking"],
    color: "from-slate-950 to-slate-800",
  },
  {
    title: "Nursing Career Path",
    pathwayName: "Nursing career path",
    description: "Focused German for nursing, hospital interviews, and healthcare documentation in Germany.",
    benefits: ["Medical vocabulary", "Interview roleplay", "Visa preparation guidance"],
    color: "from-emerald-950 to-emerald-800",
  },
  {
    title: "IT Relocation Track",
    pathwayName: "IT relocation track",
    description: "Professional German for tech interviews, job applications, and workplace communication.",
    benefits: ["CV and cover letter coaching", "Tech interview scenarios", "Workplace fluency"],
    color: "from-sky-950 to-sky-800",
  },
  {
    title: "Ausbildung & Vocational Route",
    pathwayName: "Ausbildung & vocational route",
    description: "Apprenticeship-focused instruction for vocational training and German workplace readiness.",
    benefits: ["Application support", "Trade-specific language", "Company interview practice"],
    color: "from-amber-950 to-amber-800",
  },
];

export default function ProgramsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [selected, setSelected] = useState(programs[0].pathwayName);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  return (
    <div className="min-h-screen bg-[var(--surface-alt)] py-10 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Tuition &amp; pathways</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Settle your tuition</h1>
          <p className="mt-4 max-w-2xl text-[var(--muted)]">
            Your tuition is set by your level and your branch — the pathway you pick decides what you study, not
            what you pay. Choose a track, then complete payment below.
          </p>
        </header>

        {/* The checkout comes first: it is the reason students land on this page. */}
        <TuitionCheckout pathwayName={selected} />

        <section className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <h2 className="text-2xl font-semibold">Choose your pathway</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            All four cost the same at your level. This is about the outcome you are training for.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {programs.map((program) => {
              const active = selected === program.pathwayName;
              return (
                <button
                  key={program.title}
                  type="button"
                  onClick={() => setSelected(program.pathwayName)}
                  aria-pressed={active}
                  className={`rounded-3xl bg-gradient-to-br ${program.color} p-8 text-left text-slate-50 shadow-xl transition ${
                    active ? "ring-2 ring-[#c8a24a] ring-offset-2 ring-offset-white" : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Pathway</p>
                      <h3 className="mt-3 text-2xl font-semibold">{program.title}</h3>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                        active ? "bg-[#c8a24a] text-[#1a1206]" : "bg-white/10 text-white/80"
                      }`}
                    >
                      {active ? "Selected" : "Select"}
                    </span>
                  </div>
                  <p className="mt-5 text-sm text-slate-200">{program.description}</p>
                  <ul className="mt-6 space-y-3 text-sm text-slate-200">
                    {program.benefits.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <h2 className="text-3xl font-semibold text-slate-950">Why Easyway&rsquo;s portal is different</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-[var(--border)] p-6">
              <h3 className="text-xl font-semibold">Outcome-first</h3>
              <p className="mt-3 text-[var(--muted)]">Programs are organized around results: certification success, German nursing work, IT relocation, or apprenticeship admission.</p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] p-6">
              <h3 className="text-xl font-semibold">AI-assisted progress</h3>
              <p className="mt-3 text-[var(--muted)]">Smart recommendations, mock grading, and pronunciation coaching keep every lesson on target.</p>
            </div>
            <div className="rounded-3xl border border-[var(--border)] p-6">
              <h3 className="text-xl font-semibold">Live hybrid learning</h3>
              <p className="mt-3 text-[var(--muted)]">Learners get a clear path plus live sessions, shared whiteboards, and voice roleplay support.</p>
            </div>
          </div>
          <Link
            href="/tandem"
            className="mt-6 inline-flex rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
          >
            Practise a roleplay first
          </Link>
        </section>
      </div>
    </div>
  );
}
