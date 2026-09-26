"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteChrome";
import PageHero from "@/components/PageHero";
import neuschwanstein from "@/assets/images/neuschwanstein.jpg";

/**
 * Where the journey email's "Tell me about prep classes" link lands. The
 * interest is recorded on a BUTTON press, never on page load: mail scanners and
 * link-preview bots open every link in an email, and a load-triggered "lead"
 * would make the office chase people who never asked.
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
            This is entirely optional. It has <strong>no bearing on your registration, your admission or your result</strong>,
            and tapping the button below commits you to nothing — no payment, no obligation. Our classes team will simply
            send you the next dates.
          </p>

          {state === "done" ? (
            <p className="mt-6 rounded-lg bg-[var(--green-soft)] px-4 py-3 text-sm font-semibold text-[var(--green)]">
              Thank you — our classes team will be in touch shortly with dates.
            </p>
          ) : haveLink ? (
            <>
              {error && <p className="mt-4 rounded-lg bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}
              <button
                onClick={ask}
                disabled={state === "sending"}
                className="mt-6 rounded-lg bg-[var(--navy)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {state === "sending" ? "Sending…" : "Yes, tell me about the classes"}
              </button>
            </>
          ) : (
            <p className="mt-6 rounded-lg bg-[var(--gold-soft)] px-4 py-3 text-sm text-[var(--navy)]">
              Please open this page from the link in your email, so we know who to send the dates to.
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
