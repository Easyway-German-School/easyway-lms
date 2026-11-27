"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteChrome";
import PageHero from "@/components/PageHero";
import neuschwanstein from "@/assets/images/neuschwanstein.jpg";
import { EXAM_PREP_LINK, EXAM_PREP_SIGNIN_LINK } from "@/lib/config";

/**
 * Where the journey email's "Tell me about prep classes" link lands.
 *
 * Primary job: hand the candidate into the LMS Exam Preparatory package —
 * new students register (package pre-selected), existing students sign in
 * and pay. Interest is still recorded on an explicit button press (never on
 * page load) so mail scanners don't create fake leads.
 */
export default function PreparePage() {
  return (
    <Suspense>
      <PrepareInner />
    </Suspense>
  );
}

function PrepareInner() {
  const search = useSearchParams();
  const reference = search.get("ref") ?? "";
  const email = search.get("email") ?? "";
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function ask() {
    setState("sending");
    setError("");
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(reference)}/prep-interest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "We couldn't pass that on — please try again.");
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't pass that on — please try again.");
      setState("error");
    }
  }

  const haveLink = Boolean(reference && email);

  return (
    <div className="min-h-screen">
      <PageHero
        eyebrow="Optional"
        title="Preparing for your exam"
        subtitle="Structured practice, if you want it"
        image={neuschwanstein}
        alt="Neuschwanstein Castle above a green Bavarian valley"
        position="object-[50%_40%]"
      />
      <main className="relative z-10 mx-auto -mt-14 max-w-2xl px-5 pb-20 sm:px-6">
        <div className="rounded-2xl bg-white p-6 shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5 sm:p-8">
          <p className="text-sm leading-6 text-[var(--ink-soft)]">
            Easyway runs exam-preparation classes built around the ÖSD examination — timed practice, speaking
            rehearsal with a teacher, and feedback on the same task types you will meet on the day.
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
            This is entirely optional. It has <strong>no bearing on your registration, your admission or your result</strong>.
            To join, open the Exam Preparatory package on the Easyway student portal — new students register there;
            if you already have an account, sign in and pay.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href={EXAM_PREP_LINK}
              className="inline-flex items-center justify-center rounded-lg bg-[var(--navy)] px-6 py-3 text-sm font-semibold text-white"
            >
              Join Exam Preparatory →
            </a>
            <a
              href={EXAM_PREP_SIGNIN_LINK}
              className="inline-flex items-center justify-center rounded-lg border border-[var(--navy)] px-6 py-3 text-sm font-semibold text-[var(--navy)]"
            >
              Already a student? Sign in to pay
            </a>
          </div>

          {haveLink && (
            <div className="mt-8 border-t border-[var(--line)] pt-6">
              <p className="text-sm text-[var(--ink-soft)]">
                Prefer the office to send you the next dates first? Tap below — no payment, no obligation.
              </p>
              {state === "done" ? (
                <p className="mt-4 rounded-lg bg-[var(--green-soft)] px-4 py-3 text-sm font-semibold text-[var(--green)]">
                  Thank you — our classes team will be in touch shortly with dates.
                </p>
              ) : (
                <>
                  {error && <p className="mt-4 rounded-lg bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}
                  <button
                    onClick={ask}
                    disabled={state === "sending"}
                    className="mt-4 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] disabled:opacity-40"
                  >
                    {state === "sending" ? "Sending…" : "Just tell me about the classes"}
                  </button>
                </>
              )}
            </div>
          )}

          {!haveLink && (
            <p className="mt-6 text-xs text-[var(--ink-soft)]">
              Opened this page from an email? Use the link in the message so we know who to send dates to.
            </p>
          )}

          {haveLink && (
            <p className="mt-6 text-xs text-[var(--ink-soft)]">
              <a className="font-semibold text-[var(--navy)] underline" href={`/booking/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`}>
                Back to my booking
              </a>
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
