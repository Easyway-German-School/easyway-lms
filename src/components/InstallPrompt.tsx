"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isInstalledApp } from "@/lib/client/standalone";
import { currentInstallEnv, type InstallEnv } from "@/lib/client/platform";
import { INSTALL_EVENT } from "@/lib/client/install-events";
import InstallGuide from "@/components/InstallGuide";

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
 *   recently dismissed  remembered in localStorage for 14 days, NOT forever. An
 *                       install prompt that returns on every navigation is an
 *                       advert, but one that never returns strands the student
 *                       who tapped × by accident — and on an iPhone that also
 *                       means no alerts, ever.
 *   mid-enrolment       /auth routes. Interrupting a signup form with a
 *                       modal is how you lose the signup.
 *   iOS                 No iPhone browser fires `beforeinstallprompt`, so there
 *                       is no programmatic install to offer — only the
 *                       step-by-step `InstallGuide`. That holds for Chrome, Edge
 *                       and Firefox on iPhone too (they can Add to Home Screen
 *                       since iOS 16.4), so the card is offered on ALL of them,
 *                       not just Safari.
 *
 * The card is only the prompt. The permanent way in is the `easyway:install`
 * event (lib/client/install-events.ts), fired by the "Install app" buttons on
 * the profile page and the notification panel, and handled here.
 */

// New key on purpose: the old `easyway-install-dismissed` was a permanent "1",
// so everyone who ever tapped × (or whose browser did) was exempt from the card
// forever. Ignoring it re-offers the install once to those students.
const SNOOZE_KEY = "easyway-install-snoozed-until";
const SNOOZE_DAYS = 14;

/** The event Chrome fires; not in TypeScript's DOM lib. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [env, setEnv] = useState<InstallEnv | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [guideEnv, setGuideEnv] = useState<InstallEnv | null>(null);
  // The event listener is registered once but must see the CURRENT prompt event.
  const deferredRef = useRef<InstallPromptEvent | null>(null);
  deferredRef.current = deferred;

  // Register the worker. Separate effect from the prompt logic: this must run
  // even for a browser that will never offer an install.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration rejects on an insecure origin, which is the normal case for
    // http://<lan-ip>:3000 during development. Nothing to report.
    let reloadedForController = false;
    let registration: ServiceWorkerRegistration | null = null;
    const registerWorker = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
      } catch {
        // Service workers are unavailable on some development origins.
      }
    };

    const onControllerChange = () => {
      if (reloadedForController) return;
      reloadedForController = true;
      window.location.reload();
    };

    /**
     * A long-lived installed window (the admin app someone leaves open for
     * days) never navigates, so the browser never re-checks /sw.js and a
     * deploy never reaches it — the page runs last week's JavaScript against
     * this week's API. Re-check whenever the window regains focus: the SW file
     * changes every release, so this finds the new worker, which skipWaiting()s
     * and fires controllerchange above, which reloads onto the new build.
     */
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };

    void registerWorker();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("focus", checkForUpdate);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.removeEventListener("focus", checkForUpdate);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Reading this INSIDE the installed app and being asked to install it is
    // the most common PWA-prompt bug there is. `isInstalledApp` is the shared
    // check every download affordance also uses.
    if (isInstalledApp()) return;

    // `beforeinstallprompt` can fire before the card's snooze is even read, and
    // the permanent "Install app" buttons need the event whether or not the card
    // is currently snoozed — so listen unconditionally, and gate only the card.
    const onBeforeInstall = (event: Event) => {
      // Chrome shows its own mini-infobar unless this is prevented, and that
      // infobar cannot be styled or timed — better to own the moment.
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Decide iOS from the user agent; the shared detector handles iPadOS posing
    // as a Mac and tells apart Safari, Chrome-on-iPhone and in-app browsers.
    setEnv(currentInstallEnv());

    let snoozed = false;
    try {
      snoozed = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
    } catch {
      /* Private mode denies localStorage; treat that as "not dismissed". */
    }
    if (!snoozed) setDismissed(false);

    // An install that completes elsewhere (Chrome's address-bar button) must
    // still retire the card.
    const onInstalled = () => setDismissed(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const close = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      /* Nothing to do — the card simply returns next session. */
    }
  }, []);

  const install = useCallback(async () => {
    const event = deferredRef.current;
    if (!event) {
      // Nothing to prompt with — every iPhone, and Android browsers that have
      // not (yet) fired the event. Show the steps instead.
      setGuideEnv(currentInstallEnv());
      return;
    }
    await event.prompt();
    await event.userChoice;
    // Spent either way: the event can only be used once, and a second prompt()
    // on the same event throws.
    setDeferred(null);
    close();
  }, [close]);

  // The permanent entry points (profile page, notification panel) land here.
  // Deliberately not gated on the snooze or the route: they are an explicit
  // request, and the card's "not now" must never block them.
  useEffect(() => {
    const onRequest = () => {
      if (isInstalledApp()) return;
      void install();
    };
    window.addEventListener(INSTALL_EVENT, onRequest);
    return () => window.removeEventListener(INSTALL_EVENT, onRequest);
  }, [install]);

  const closeGuide = useCallback(() => setGuideEnv(null), []);

  const guide = guideEnv ? <InstallGuide env={guideEnv} onClose={closeGuide} /> : null;

  const onAuthRoute = pathname?.startsWith("/auth") ?? false;
  const isIos = env?.ios === true;
  const hasSomethingToSay = deferred !== null || isIos;
  // The card steps aside while the guide is open — two stacked sheets is noise.
  if (dismissed || onAuthRoute || !hasSomethingToSay || guideEnv !== null) return guide;

  const iosSteps = isIos && !deferred;

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
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {iosSteps ? "Add EasyWay to your Home Screen" : "Never miss a class, assignment or exam alert"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {iosSteps
                ? "iPhone only sends class and exam alerts to apps on your Home Screen — and your notes open offline with zero data."
                : "Get alerts the second they drop, and read your notes offline — so a low bundle (or none at all) never costs you a class."}
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

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void install()}
            className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {deferred ? "Get the app" : "Show me how"}
          </button>
          <button
            onClick={close}
            className="rounded-full px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
