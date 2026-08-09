"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Registers the service worker, and offers to install the app.
 *
 * TWO JOBS IN ONE COMPONENT because they share a precondition. The service
 * worker used to be registered only by `usePushNotifications`, which runs when
 * a student opts into notifications — so anybody who never touched that toggle
 * had no worker at all, and therefore no offline shell. Registration belongs
 * on every page load, not behind a feature. Registering the same URL twice is
 * a no-op (the browser returns the existing registration), so use-push.ts is
 * left exactly as it is.
 *
 * THE HARD PART IS NOT SHOWING THE CARD — it is not showing it to the wrong
 * person. There are four ways to already be uninstallable, and each one has to
 * be checked separately because no single API answers the question:
 *
 *   already installed   `display-mode: standalone` matches, or on iOS the
 *                       non-standard `navigator.standalone` is true. A person
 *                       reading this INSIDE the installed app being asked to
 *                       install it is the most common PWA-prompt bug there is.
 *   already dismissed   remembered in localStorage. An install prompt that
 *                       returns on every navigation is an advert.
 *   mid-enrolment       /auth routes. Interrupting a signup form with a
 *                       modal is how you lose the signup.
 *   iOS                 Safari never fires `beforeinstallprompt`, so there is
 *                       no programmatic install to offer — only instructions.
 */

const DISMISS_KEY = "easyway-install-dismissed";

/** The event Chrome fires; not in TypeScript's DOM lib. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  // Register the worker. Separate effect from the prompt logic: this must run
  // even for a browser that will never offer an install.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration rejects on an insecure origin, which is the normal case for
    // http://<lan-ip>:3000 during development. Nothing to report.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let alreadySaidNo = false;
    try {
      alreadySaidNo = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* Private mode denies localStorage; treat that as "not dismissed". */
    }
    if (alreadySaidNo) return;

    setDismissed(false);

    const onBeforeInstall = (event: Event) => {
      // Chrome shows its own mini-infobar unless this is prevented, and that
      // infobar cannot be styled or timed — better to own the moment.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS: no event is coming, so decide from the user agent. iPadOS reports
    // itself as a Mac, hence the touch-points check alongside the platform one.
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setShowIosHint(true);

    // An install that completes elsewhere (Chrome's address-bar button) must
    // still retire the card.
    const onInstalled = () => setDismissed(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* Nothing to do — the card simply returns next session. */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // Spent either way: the event can only be used once, and a second prompt()
    // on the same event throws.
    setDeferred(null);
    close();
  };

  const onAuthRoute = pathname?.startsWith("/auth") ?? false;
  const hasSomethingToSay = deferred !== null || showIosHint;
  if (dismissed || onAuthRoute || !hasSomethingToSay) return null;

  return (
    // Bottom CENTRE on a phone and bottom-right on desktop, because the portal
    // already spends both bottom corners on small screens: the community
    // launcher owns one and the moment dock the other.
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-sm sm:inset-x-auto sm:right-5 sm:bottom-5">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static
              192px icon in a transient card; next/image would add a loader
              round-trip for a file already in the manifest. */}
          <img src="/icon-192.png" alt="" className="h-11 w-11 flex-none rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--foreground)]">Put EasyWay on your home screen</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {showIosHint && !deferred
                ? "Tap the Share button below, then “Add to Home Screen”."
                : "Opens like an app, remembers you, and works without the browser bar."}
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Not now"
            className="-mr-1 -mt-1 flex-none rounded-lg px-2 py-1 text-lg leading-none text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            ×
          </button>
        </div>

        {deferred ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={install}
              className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Install
            </button>
            <button
              onClick={close}
              className="rounded-full px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              Not now
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
