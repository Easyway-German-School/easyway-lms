"use client";

import { useEffect, useState } from "react";
import { useBranding } from "@/components/BrandingProvider";

/**
 * The school's logo.
 *
 * Two shapes, because the artwork is a horizontal lockup (emblem + stacked
 * school name) and a horizontal lockup cannot be squeezed into a 44px square
 * without becoming unreadable:
 *
 *   variant="wordmark"  the full lockup — expanded sidebars, auth pages
 *   variant="mark"      just the emblem — collapsed sidebar, tight spaces
 *
 * Files, both optional:
 *   public/logo.png        the full lockup
 *   public/logo-mark.png   the emblem on its own (square)
 *
 * Anything missing falls back: mark → wordmark → "EW" monogram. The image is
 * only swapped in after a probe confirms it loads. Rendering the <img> first
 * and relying on onError does NOT work — the request fails during hydration,
 * before React attaches the handler, leaving a broken-image icon on screen.
 */

/**
 * These are the fallbacks, not the answer. The tenant's own lockup and mark
 * come from BrandingProvider and default to exactly these, so a school that has
 * chosen no artwork renders precisely what this file rendered before it was
 * tenant-aware.
 */
const DEFAULT_WORDMARK_SRC = "/logo.png";
const DEFAULT_MARK_SRC = "/logo-mark.png";

/** Resolves once per src; returns null while still checking. */
function useImageAvailable(src: string): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { if (!cancelled) setAvailable(true); };
    probe.onerror = () => { if (!cancelled) setAvailable(false); };
    probe.src = src;
    return () => { cancelled = true; };
  }, [src]);

  return available;
}

function Monogram({
  className,
  name,
  initials,
}: {
  className: string;
  name: string;
  initials: string;
}) {
  return (
    <div
      className={`${className} flex items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] font-semibold text-white shadow-lg shadow-[var(--accent)]/20`}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

export default function BrandLogo({
  variant = "wordmark",
  className,
}: {
  variant?: "wordmark" | "mark";
  className?: string;
}) {
  const branding = useBranding();
  const WORDMARK_SRC = branding.logoUrl || DEFAULT_WORDMARK_SRC;
  const MARK_SRC = branding.markUrl || DEFAULT_MARK_SRC;

  const hasWordmark = useImageAvailable(WORDMARK_SRC);
  const hasMark = useImageAvailable(MARK_SRC);

  if (variant === "mark") {
    const box = className ?? "h-11 w-11";

    if (hasMark) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={MARK_SRC} alt={branding.name} className={`${box} shrink-0 rounded-2xl object-contain`} />;
    }

    // No dedicated emblem: crop the left edge of the lockup, which is where
    // the emblem sits, rather than shrinking the whole thing into nothing.
    if (hasWordmark) {
      return (
        <div className={`${box} shrink-0 overflow-hidden rounded-2xl bg-white`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WORDMARK_SRC} alt={branding.name} className="h-full w-auto max-w-none object-cover object-left" />
        </div>
      );
    }

    return <Monogram className={`${box} shrink-0 text-sm`} name={branding.name} initials={branding.initials} />;
  }

  // Wordmark. Height-constrained and width-auto so the lockup keeps its
  // proportions whatever the source file's exact dimensions are.
  const box = className ?? "h-10";

  if (hasWordmark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={WORDMARK_SRC} alt={branding.name} className={`${box} w-auto max-w-full shrink-0 object-contain`} />;
  }

  /**
   * While probing, and when there is no artwork at all, the monogram sits
   * beside the name so the header never collapses to empty space.
   *
   * The name is split on its first word rather than hardcoded, so a tenant
   * called "Bright Star Academy" reads "BRIGHT / Star Academy" instead of
   * somebody else's school name in a fallback nobody remembered to update.
   */
  const [firstWord, ...restWords] = branding.name.split(" ");

  return (
    <div className="flex items-center gap-3">
      <Monogram className="h-11 w-11 text-sm" name={branding.name} initials={branding.initials} />
      <div className="leading-tight">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{firstWord}</p>
        {restWords.length > 0 && (
          <p className="text-xs font-bold text-[var(--foreground)]">{restWords.join(" ")}</p>
        )}
      </div>
    </div>
  );
}
