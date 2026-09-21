"use client";

import { useEffect } from "react";

/**
 * Keep the screen on while `active`.
 *
 * WHY THIS EXISTS: an iPhone locks itself after 30 seconds to 5 minutes without
 * a touch, and a student watching a live class is exactly the person who does
 * not touch the screen. When the phone locks, Safari suspends the tab and the
 * camera and microphone with it — the student silently drops out of the class
 * and comes back to a reconnect spinner. A wake lock is the standard fix; iOS
 * has honoured it since Safari 16.4.
 *
 * Deliberately best-effort. The request is refused on low battery, in Low Power
 * Mode, in an unsupported browser and in some installed-app windows, and none of
 * those may ever break or delay joining a class — so every failure is swallowed
 * and the class carries on exactly as it did before this hook existed.
 *
 * Two behaviours worth knowing:
 *   - The browser RELEASES the lock whenever the tab is hidden (a student
 *     switching to WhatsApp), and does not hand it back. So it is re-requested
 *     each time the tab becomes visible again.
 *   - It is released on cleanup, so a student who leaves the room gets their
 *     normal auto-lock back immediately.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          // The room closed while the request was in flight.
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        /* Refused (battery saver, permissions policy, unsupported window). Never fatal. */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
