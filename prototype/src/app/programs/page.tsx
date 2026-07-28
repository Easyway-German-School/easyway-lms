"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { safeJson } from "@/lib/safe-json";

const programs = [
  {
    title: "Goethe Exam Mastery",
    pathwayName: "Goethe exam mastery",
    description: "Targeted A1–C1 exam training with structured writing, speaking, and mock evaluation.",
    benefits: ["Exam-level feedback", "Grammar drills", "Mock Goethe score tracking"],
    color: "from-slate-950 to-slate-800",
    registrationFee: 5000,
    tuitionFee: 150000,
  },
  {
    title: "Nursing Career Path",
    pathwayName: "Nursing career path",
    description: "Focused German for nursing, hospital interviews, and healthcare documentation in Germany.",
    benefits: ["Medical vocabulary", "Interview roleplay", "Visa preparation guidance"],
    color: "from-emerald-950 to-emerald-800",
    registrationFee: 5000,
    tuitionFee: 180000,
  },
  {
    title: "IT Relocation Track",
    pathwayName: "IT relocation track",
    description: "Professional German for tech interviews, job applications, and workplace communication.",
    benefits: ["CV and cover letter coaching", "Tech interview scenarios", "Workplace fluency"],
    color: "from-sky-950 to-sky-800",
    registrationFee: 5000,
    tuitionFee: 180000,
  },
  {
    title: "Ausbildung & Vocational Route",
    pathwayName: "Ausbildung & vocational route",
    description: "Apprenticeship-focused instruction for vocational training and German workplace readiness.",
    benefits: ["Application support", "Trade-specific language", "Company interview practice"],
    color: "from-amber-950 to-amber-800",
    registrationFee: 5000,
    tuitionFee: 200000,
  },
];

type Program = typeof programs[number];

export default function ProgramsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [processingProgram, setProcessingProgram] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      setCheckoutError("Please sign in before paying. Redirecting to login...");
      router.push("/auth/signin");
    }
  }, [status, router]);

  async function startCheckout(program: Program, mode: "deposit" | "full") {
    if (status === "loading") {
      return;
    }

    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }

    setProcessingProgram(program.title);
    setCheckoutError(null);

    try {
      setCheckoutLoading(true);
      setCheckoutError(null);

      const amountToCharge = mode === "deposit" ? Math.round(program.tuitionFee * 0.6) : Math.round(program.tuitionFee);
      const depositPercent = mode === "deposit" ? 60 : 100;
      const paymentStage = mode === "deposit" ? "deposit" : "full";

      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pathwayId: program.pathwayName,
          pathwayName: program.pathwayName,
          amount: amountToCharge,
          tuitionFee: program.tuitionFee,
          depositPercent,
          paymentStage,
        }),
      });

      const data = await safeJson(res);
      if (!res.ok || !data) {
        throw new Error(data?.error || "Unable to start checkout");
      }

      if (!data.authorization_url) {
        throw new Error("Paystack did not return a checkout link.");
      }

      if (data.reference) {
        window.localStorage.setItem("pendingPaystackReference", String(data.reference));
        window.localStorage.setItem("pendingPaystackAmount", String(amountToCharge));
        window.localStorage.setItem("pendingPaystackPathwayName", program.pathwayName);
      }

      window.location.href = data.authorization_url;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Unable to start checkout");
    } finally {
      setProcessingProgram(null);
      setCheckoutLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 text-slate-950">
      <div className="mx-auto max-w-6xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Pathway hub</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Advanced German learning tracks</h1>
          <p className="mt-4 text-slate-600">
            Choose a program built for the real outcome you want—Goethe, nursing, IT relocation, or Ausbildung. Each path includes structured lessons, live coaching, and AI-backed assessment.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {programs.map((program) => (
            <div key={program.title} className={`rounded-3xl bg-gradient-to-br ${program.color} p-8 text-slate-50 shadow-xl`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Program</p>
                  <h2 className="mt-3 text-3xl font-semibold">{program.title}</h2>
                </div>
                <span className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/90">Advanced</span>
              </div>
              <p className="mt-5 text-slate-200">{program.description}</p>
              <ul className="mt-6 space-y-3 text-sm text-slate-200">
                {program.benefits.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm text-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">Payment choice</p>
                  </div>
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100">
                    {program.tuitionFee.toLocaleString()} NGN full
                  </span>
                </div>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex animate-pulse items-center rounded-full bg-amber-300/25 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.35)]">
                    Highly recommended
                  </span>
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100">
                    Not recommended
                  </span>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startCheckout(program, "full")}
                    disabled={processingProgram === program.title || checkoutLoading}
                    className="rounded-2xl bg-white px-6 py-3 text-lg font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_0_30px_rgba(255,255,255,0.35)] transition hover:-translate-y-0.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {processingProgram === program.title && checkoutLoading ? "Opening…" : "Pay 100% now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startCheckout(program, "deposit")}
                    disabled={processingProgram === program.title || checkoutLoading}
                    className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white/80 shadow-[0_0_10px_rgba(255,255,255,0.1)] transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {processingProgram === program.title && checkoutLoading ? "Opening…" : "Pay 60% now"}
                  </button>
                  <Link href="/tandem" className="rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                    Practice roleplay
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        {checkoutLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700 shadow-sm">
            <p className="font-semibold">Preparing your Paystack checkout</p>
            <p className="mt-2">We are opening the secure payment page now. You will be redirected back to your dashboard after payment completes. Do not refresh or close this tab.</p>
          </div>
        ) : null}

        {checkoutError ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
            <p className="font-semibold">Payment initialization failed</p>
            <p className="mt-2">{checkoutError}</p>
          </div>
        ) : null}

        <section className="rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-semibold text-slate-950">Why Easyway’s portal is different</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 p-6">
              <h3 className="text-xl font-semibold">Outcome-first</h3>
              <p className="mt-3 text-slate-600">Programs are organized around results: Goethe success, German nursing work, IT relocation, or apprenticeship admission.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 p-6">
              <h3 className="text-xl font-semibold">AI-assisted progress</h3>
              <p className="mt-3 text-slate-600">Smart recommendations, mock grading, and pronunciation coaching keep every lesson on target.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 p-6">
              <h3 className="text-xl font-semibold">Live hybrid learning</h3>
              <p className="mt-3 text-slate-600">Learners get a clear path plus live sessions, shared whiteboards, and voice roleplay support.</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-slate-950 p-8 text-slate-50 shadow-xl">
          <h2 className="text-3xl font-semibold">Simple for learners, powerful on the backend</h2>
          <p className="mt-4 text-slate-300">
            The student sees one clean dashboard and a clear program path. Behind the scenes, we manage curriculum modules, AI scoring, progression rules, and pathway logic.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Backend</p>
              <p className="mt-3 text-lg font-semibold">Adaptive curriculum engine</p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Student</p>
              <p className="mt-3 text-lg font-semibold">One dashboard, one path, one clean progress view</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
