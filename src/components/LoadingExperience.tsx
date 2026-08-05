"use client";

import { BrandLoaderMark } from "@/components/BrandLoader";

/**
 * A waiting state with an explanation, for waits the user should understand
 * rather than just sit through — payment verification, account provisioning.
 *
 * Where <BrandLoader /> is a compact centred column, this is a two-column
 * card: the animated emblem on the left, the reason for the wait on the right.
 */
export default function LoadingExperience({
  title = "Einen Moment, bitte…",
  message = "Your learning world is loading. We’re warming up the classroom and refreshing your dashboard.",
  detail = "Refreshing your latest classes, payments, and progress.",
}: {
  title?: string;
  message?: string;
  /** The line beside the pulsing dot. */
  detail?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[48vh] items-center justify-center px-2 py-6 sm:px-6"
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)] sm:p-10">
        {/* Brand-tinted corner glows. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 bottom-4 h-36 w-36 rounded-full blur-3xl"
          style={{ background: "color-mix(in srgb, var(--accent-strong) 18%, transparent)" }}
        />

        <div className="relative z-10 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
          <div className="flex justify-center sm:justify-start">
            <BrandLoaderMark size="lg" />
          </div>

          <div>
            {/* No name eyebrow here either — the emblem sits directly beside
                this block and already carries it. See BrandLoader. */}
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--muted)]">{message}</p>

            <div className="mt-6 flex items-center gap-3 text-sm font-medium text-[var(--muted)]">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <span>{detail}</span>
            </div>

            {/* Indeterminate track, matching <BrandLoader />. */}
            <div
              aria-hidden
              className="relative mt-6 h-1 w-full max-w-xs overflow-hidden rounded-full"
              style={{ background: "color-mix(in srgb, var(--accent-strong) 14%, transparent)" }}
            >
              <div
                className="ew-track absolute inset-y-0 w-1/3 rounded-full"
                style={{ background: "linear-gradient(90deg, var(--accent-strong), var(--accent))" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
