"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { InstallEnv } from "@/lib/client/platform";
import { AddSquareIcon, BellIcon, CheckIcon, LinkIcon, ShareSquareIcon, CrossIcon } from "@/components/icons";

/**
 * Step-by-step "how do I install this?" for the platforms that cannot be
 * installed with a single button.
 *
 * That is every iPhone. Apple has never shipped `beforeinstallprompt`, so there
 * is no code we can run that installs the app — the only thing we can do is
 * show the student exactly where to tap. A one-line hint ("tap Share, then Add
 * to Home Screen") is what shipped first, and it failed the test that matters:
 * a student on an iPhone 14 Pro could not find the Share button (it moved into
 * the ⋯ menu in newer iOS), did not know Chrome could do it too, and had no idea
 * why they were being asked.
 *
 * So the steps are per browser, in the words the student will see on screen,
 * and the last step covers the surprise that costs the most: the Home Screen
 * app does NOT share Safari's login, so they must sign in once inside it.
 */

type Step = { icon: ReactNode; title: string; detail: string };

const ICON = "h-5 w-5";

function stepsFor(env: InstallEnv): { heading: string; intro: string; steps: Step[]; copyLink: boolean } {
  if (env.ios) {
    const finish: Step[] = [
      {
        icon: <AddSquareIcon className={ICON} />,
        title: "Scroll down and tap “Add to Home Screen”",
        detail: "Not in the list? Scroll the sheet, or tap “View More”. Then tap “Add” in the top corner.",
      },
      {
        icon: <BellIcon className={ICON} />,
        title: "Open EasyWay from your Home Screen",
        detail:
          "Sign in once inside the app (it doesn't share your Safari login), then tap “Yes, remind me” when it asks about alerts.",
      },
    ];

    if (env.browser === "inapp") {
      return {
        heading: "Open EasyWay in Safari first",
        intro:
          "You're inside another app's browser (WhatsApp, Instagram, Facebook…), and those can't add apps to your Home Screen.",
        copyLink: true,
        steps: [
          {
            icon: <LinkIcon className={ICON} />,
            title: "Open this page in Safari",
            detail:
              "Tap ⋯ or the compass icon at the corner of this screen and choose “Open in Safari” — or copy the link below and paste it into Safari.",
          },
          {
            icon: <ShareSquareIcon className={ICON} />,
            title: "In Safari, tap the Share button",
            detail: "The square with an arrow. On newer iPhones it's inside the ⋯ menu at the bottom right.",
          },
          ...finish,
        ],
      };
    }

    if (env.browser === "safari") {
      return {
        heading: "Add EasyWay to your iPhone",
        intro: "It takes 20 seconds, and it's the only way iPhone can send you class and exam alerts.",
        copyLink: false,
        steps: [
          {
            icon: <ShareSquareIcon className={ICON} />,
            title: "Tap the Share button",
            detail: "The square with an arrow, at the bottom of Safari. On newer iPhones tap ⋯ first, then Share.",
          },
          ...finish,
        ],
      };
    }

    // Chrome / Edge / Firefox on iPhone: capable since iOS 16.4, but each hides
    // the Share button somewhere different.
    return {
      heading: "Add EasyWay to your iPhone",
      intro: "It takes 20 seconds, and it's the only way iPhone can send you class and exam alerts.",
      copyLink: true,
      steps: [
        {
          icon: <ShareSquareIcon className={ICON} />,
          title: "Tap the Share icon",
          detail:
            "Next to the address bar at the top, or inside the ⋯ menu. No “Add to Home Screen” option? Open this page in Safari and start again — copy the link below.",
        },
        ...finish,
      ],
    };
  }

  if (env.android) {
    if (env.browser === "inapp") {
      return {
        heading: "Open EasyWay in Chrome first",
        intro: "You're inside another app's browser, which can't install apps.",
        copyLink: true,
        steps: [
          {
            icon: <LinkIcon className={ICON} />,
            title: "Open this page in Chrome",
            detail: "Tap ⋮ at the top right and choose “Open in Chrome” — or copy the link below and paste it into Chrome.",
          },
          {
            icon: <AddSquareIcon className={ICON} />,
            title: "Tap ⋮, then “Install app”",
            detail: "It may say “Add to Home screen”. Confirm, and EasyWay appears with your other apps.",
          },
        ],
      };
    }
    return {
      heading: "Install EasyWay",
      intro: "Get alerts the second they drop, and read your notes offline.",
      copyLink: false,
      steps: [
        {
          icon: <AddSquareIcon className={ICON} />,
          title: "Tap ⋮, then “Install app”",
          detail: "It may say “Add to Home screen”. Confirm, and EasyWay appears with your other apps.",
        },
        {
          icon: <BellIcon className={ICON} />,
          title: "Open EasyWay and allow alerts",
          detail: "Tap “Yes, remind me” when it asks, so class and exam alerts reach your lock screen.",
        },
      ],
    };
  }

  return {
    heading: "Install EasyWay",
    intro: "Get alerts the second they drop, and read your notes offline.",
    copyLink: false,
    steps: [
      {
        icon: <AddSquareIcon className={ICON} />,
        title: "Use your browser's install option",
        detail: "In Chrome or Edge, click the install icon at the right end of the address bar, or open the ⋮ menu and choose “Install”.",
      },
    ],
  };
}

export default function InstallGuide({ env, onClose }: { env: InstallEnv; onClose: () => void }) {
  const { heading, intro, steps, copyLink } = stepsFor(env);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Clipboard is blocked in some in-app browsers; the address is printed under the button instead. */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static icon in a transient sheet */}
          <img src="/icon-192.png" alt="" className="h-12 w-12 flex-none rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[var(--foreground)]">{heading}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-9 w-9 flex-none place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            <CrossIcon className="h-4 w-4" />
          </button>
        </div>

        {env.iosTooOldForPush ? (
          <p className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Your iPhone is on an older iOS, which can&apos;t receive web alerts. Update in Settings › General › Software
            Update (iOS 16.4 or newer), then come back here. You can still add EasyWay to your Home Screen now.
          </p>
        ) : null}

        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                {step.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  <span className="mr-1.5 text-[var(--muted)]">{index + 1}.</span>
                  {step.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        {copyLink ? (
          <button
            type="button"
            onClick={copy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
          >
            {copied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
            {copied ? "Link copied" : "Copy link to paste in your browser"}
          </button>
        ) : null}
        {copyLink ? (
          <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
            Or type <span className="font-semibold">{typeof window !== "undefined" ? window.location.host : ""}</span> into
            the browser.
          </p>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
