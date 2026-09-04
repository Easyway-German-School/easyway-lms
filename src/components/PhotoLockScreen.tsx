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
 */
export default function PhotoLockScreen({ areaLabel }: { areaLabel: string }) {
  return (
    <div className="flex min-h-[calc(100vh-1px)] flex-col items-center justify-center px-6 py-14 text-center">
      <Mascot mood="concerned" className="h-40 w-40" />

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.42em] text-[var(--accent)]">
        {areaLabel} locked
      </p>

      <h1 className="mt-3 max-w-lg text-2xl font-semibold leading-snug text-[var(--foreground)]">
        Add a photo to your profile to continue
      </h1>

      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
        It puts a face to your name for your tutor and classmates, and it is the one that goes on
        your certificate. It takes ten seconds — upload one or use your camera.
      </p>

      <Link
        href="/profile"
        className="mt-7 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:brightness-110"
      >
        Add my photo now
      </Link>
    </div>
  );
}
