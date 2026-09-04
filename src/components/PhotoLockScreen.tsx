"use client";

import Link from "next/link";
import Mascot from "@/components/Mascot";

/**
 * Walls off the portal for a student with no photo on file.
 *
 * Deliberately plain next to PaymentLockScreen's full production — this is
 * not a sales moment, it is a ten-second chore, so it gets one screen and one
 * button rather than a reveal animation and a road map. The upload itself
 * lives on /profile (already built, already writes admission.photoUrl) —
 * this screen only ever points there, it never duplicates that form.
 *
 * WHY THE PAYMENT LINE COMES FIRST: a student who has actually paid and then
 * meets a locked dashboard reads it, instinctively, as "something's wrong
 * with my payment" — the one lock screen this portal has trained them to
 * expect. Saying so before anything else, in Becca's voice rather than a
 * bare system message, is what keeps this from landing as a punishment for
 * a mistake they didn't make. `/api/student/access` backs this up with a
 * one-time notification the moment they first hit this wall, in case they
 * see it on their phone before they see this screen.
 */
export default function PhotoLockScreen({ areaLabel }: { areaLabel: string }) {
  return (
    <div className="flex min-h-[calc(100vh-1px)] flex-col items-center justify-center px-6 py-14 text-center">
      <Mascot mood="smiling" className="h-40 w-40" />

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.42em] text-emerald-500">
        Your payment is all sorted ✓
      </p>

      <h1 className="mt-3 max-w-lg text-2xl font-semibold leading-snug text-[var(--foreground)]">
        Just one more thing before {areaLabel.toLowerCase()} opens up
      </h1>

      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
        Becca here — this has nothing to do with your fees, promise. Your profile is just missing a
        photo, and it takes about ten seconds to fix (camera or upload both work). It puts a face to
        your name for your tutor and classmates, and it is the one that goes on your certificate.
      </p>

      <Link
        href="/profile"
        className="mt-7 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:brightness-110"
      >
        Add my photo now
      </Link>

      <p className="mt-4 text-xs text-[var(--muted)]">
        Everything unlocks the moment it saves — no need to come back or refresh.
      </p>
    </div>
  );
}
