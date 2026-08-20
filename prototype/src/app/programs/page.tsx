"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import TuitionCheckout from "@/components/TuitionCheckout";
import PremiumPrivateClasses from "@/components/PremiumPrivateClasses";

/**
 * The tuition checkout.
 *
 * Programs used to carry their own prices (Language ₦150k, Nursing ₦180k …) while
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

type StudentInfo = {
  classType: string;
  level?: string;
  branchName?: string;
  /** Just enough of the payment picture to know if this is still a new, unpaid registrant. */
  hasUnlockedClasses?: boolean;
};

/**
 * The one-time nudge toward private tuition for a brand-new, unpaid registrant.
 *
 * The inline PremiumPrivateClasses card below already carries the full pitch —
 * this popup exists only to make sure a student who registered and never paid
 * actually sees it, instead of scrolling past it on their way to the checkout
 * button. Shown once per browser session (sessionStorage, not localStorage —
 * a shared/cyber-cafe device should not remember it forever) and never again
 * once dismissed or once they've upgraded.
 */
function PrivateUpsellPopup({ onExplore, onDismiss }: { onExplore: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl border-2 border-[#c8a24a]/40 bg-[var(--surface)] p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#c8a24a]">Before you pay for the group class</p>
        <h2 className="mt-3 text-xl font-bold text-[var(--foreground)]">Consider one-to-one instead</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          A tutor to yourself, times you choose, and a faster route to fluency — see the private tuition package
          below before you settle on the group track.
        </p>
        <div className="mt-4 rounded-2xl border border-[#c8a24a]/25 bg-[#c8a24a]/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c8a24a]">Included private AI studio</p>
          <p className="mt-2 text-sm text-[var(--foreground)]">More daily essay grading, pronunciation practice, and mission coaching, shaped around your private tutor&apos;s plan.</p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onExplore}
            className="flex-1 rounded-full bg-[#c8a24a] px-5 py-2.5 text-sm font-semibold text-[#1a1206] transition hover:brightness-110"
          >
            Show me the package
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
          >
            Continue with group
          </button>
        </div>
      </div>
    </div>
  );
}

const UPSELL_SEEN_KEY = "easyway:private-upsell-seen";

export default function ProgramsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [selected, setSelected] = useState(programs[0].pathwayName);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [showUpsellPopup, setShowUpsellPopup] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  // Just enough of the student record to decide whether the private-classes
  // upsell below applies — moved here from the dashboard, which is not the
  // place for an upsell (see PremiumPrivateClasses).
  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/student", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const classType = data.classType ?? "group";
        const hasUnlockedClasses = Boolean(data.paymentSummary?.depositPaid ?? data.paymentSummary?.fullPaid);
        setStudent({
          classType,
          level: data.level ?? undefined,
          branchName: data.branchName ?? undefined,
          hasUnlockedClasses,
        });

        const alreadySeen = typeof window !== "undefined" && window.sessionStorage.getItem(UPSELL_SEEN_KEY);
        if (!alreadySeen && classType !== "private" && !hasUnlockedClasses) {
          setShowUpsellPopup(true);
        }
      } catch {
        // The pathway picker and checkout above still work without this.
      }
    })();
  }, [status]);

  function dismissUpsellPopup() {
    setShowUpsellPopup(false);
    if (typeof window !== "undefined") window.sessionStorage.setItem(UPSELL_SEEN_KEY, "1");
  }

  function exploreUpsellPopup() {
    dismissUpsellPopup();
    document.getElementById("private-upgrade")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen bg-[var(--surface-alt)] py-10 text-[var(--foreground)]">
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
                      <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Pathway</p>
                      <h3 className="mt-3 text-2xl font-semibold">{program.title}</h3>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                        active ? "bg-[#c8a24a] text-[#1a1206]" : "bg-[var(--surface-alt)] text-white/80"
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

        {/* Was on the dashboard, which a student opens every day for things
            that are still true an hour later — an upsell isn't one of them.
            It belongs with the other "study more, differently" choices, here
            and on the payment lock screen for students who haven't paid yet. */}
        <div id="private-upgrade">{student ? <PremiumPrivateClasses student={student} /> : null}</div>
      </div>

      {showUpsellPopup && <PrivateUpsellPopup onExplore={exploreUpsellPopup} onDismiss={dismissUpsellPopup} />}
    </div>
  );
}
