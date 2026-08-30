"use client";

import { useEffect, useState } from "react";

/**
 * "Is this the installed app, or a browser tab?"
 *
 * Offline downloads are only ever OFFERED inside the installed PWA — that is
 * the whole marketing lever: to keep classes and notes on your phone with no
 * signal, you install the app. (It is a UX gate, not DRM: IndexedDB is
 * origin-scoped and a determined user could script it from a tab. We just
 * never show the button there.)
 *
 * No single API answers this. `display-mode: standalone` covers Android/Chrome
 * and desktop installs; iOS Safari never matches it and exposes the
 * non-standard `navigator.standalone` instead. This checks both, the same way
 * `InstallPrompt.tsx` always has — extracted here so every download affordance
 * agrees on the answer.
 */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const displayModeStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      window.matchMedia?.("(display-mode: minimal-ui)").matches;
    const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
    return Boolean(displayModeStandalone || iosStandalone);
  } catch {
    return false;
  }
}

/**
 * Hook form. Starts `false` on the server and first client render (so markup
 * matches and hydration is clean), then settles to the real answer and tracks
 * it live — a person can install mid-session and the display-mode media query
 * flips without a reload.
 */
export function useIsInstalledApp(): boolean {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const update = () => setInstalled(isInstalledApp());
    update();

    const queries = ["(display-mode: standalone)", "(display-mode: minimal-ui)", "(display-mode: fullscreen)"]
      .map((q) => {
        try {
          return window.matchMedia(q);
        } catch {
          return null;
        }
      })
      .filter((m): m is MediaQueryList => m !== null);

    for (const mq of queries) mq.addEventListener?.("change", update);
    window.addEventListener("appinstalled", update);
    return () => {
      for (const mq of queries) mq.removeEventListener?.("change", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);

  return installed;
}

/** Live `navigator.onLine`, as a hook. `true` until the browser says otherwise. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
