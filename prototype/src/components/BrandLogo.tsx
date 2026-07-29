"use client";

import { useEffect, useState } from "react";

/**
 * The school's logo.
 *
 * Drop the real artwork at `public/logo.png` and it appears everywhere at
 * once. Until then the "EW" monogram shows.
 *
 * The monogram is the DEFAULT and the image is swapped in only after it has
 * been confirmed to load. Rendering the <img> first and falling back via
 * onError does not work: the request fails during hydration, before React has
 * attached the handler, so the error is never seen and a broken-image icon
 * sits in the sidebar permanently.
 */

const LOGO_SRC = "/logo.png";

export default function BrandLogo({ className = "h-11 w-11" }: { className?: string }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { if (!cancelled) setLoaded(true); };
    probe.onerror = () => { /* No logo file yet — keep the monogram. */ };
    probe.src = LOGO_SRC;
    return () => { cancelled = true; };
  }, []);

  if (loaded) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={LOGO_SRC}
        alt="Easyway German Language School"
        className={`${className} rounded-2xl object-contain`}
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20`}
      aria-label="Easyway German Language School"
    >
      EW
    </div>
  );
}
