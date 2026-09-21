"use client";

/**
 * THE "ON AIR" LOOK for a sidebar entry, shared by the student, tutor and admin
 * shells so the three cannot drift apart.
 *
 * A class in progress is the one thing in a sidebar that is true right now and
 * stops being true, so it is the one thing allowed to glow. Three pieces, used
 * together:
 *
 *   - `LIVE_ICON_TILE`  — swap the icon tile's border/fill for the red glow.
 *   - `LiveDot`         — the pinging dot on the tile's corner. It is the only
 *                         part that survives a collapsed rail, where the label
 *                         and the pill are gone.
 *   - `LivePill`        — "LIVE" (or "2 LIVE" for an admin watching several
 *                         rooms) at the right-hand end of the row.
 */

/** Border, fill, text and pulsing glow for the icon tile of a live entry. */
export const LIVE_ICON_TILE =
  "ew-live-glow border-rose-500/60 bg-rose-500/10 text-rose-500";

export function LiveDot() {
  return (
    <span className="pointer-events-none absolute -right-1 -top-1 flex h-3 w-3" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500 ring-2 ring-[var(--surface)]" />
    </span>
  );
}

export function LivePill({ count }: { count?: number }) {
  return (
    <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_0_12px_rgba(244,63,94,0.55)]">
      {count && count > 1 ? `${count} live` : "Live"}
    </span>
  );
}
