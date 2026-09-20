"use client";

import type { ReactNode } from "react";
import { AddSquareIcon, BellIcon, BellOffIcon, CheckCircleIcon } from "@/components/icons";
import { requestInstall } from "@/lib/client/install-events";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { usePushNotifications } from "@/lib/use-push";

/**
 * The permanent home for "install the app" and "turn on alerts".
 *
 * Both used to exist only as popups a student could dismiss and never see
 * again, so a student who missed them — or whose iPhone hid the alerts toggle
 * entirely (iOS reports Web Push as unsupported in a browser tab) — had no
 * button anywhere to fix it. This card is always on the profile page and always
 * says what state this device is in and the one thing to do about it.
 */
export default function AppAlertsCard() {
  const installed = useIsInstalledApp();
  const push = usePushNotifications();

  const row = "flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4";
  const primary =
    "shrink-0 rounded-full bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60";

  const secondary =
    "shrink-0 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:opacity-60";

  let alerts: { text: string; action: ReactNode };
  if (push.enabled) {
    alerts = {
      text: "On for this device. Class, material and payment alerts reach your lock screen.",
      action: (
        <button type="button" onClick={() => void push.disable()} disabled={push.busy} className={secondary}>
          {push.busy ? "Working…" : "Turn off"}
        </button>
      ),
    };
  } else if (push.supported && push.permission === "denied") {
    alerts = {
      text: "Blocked for this device. Allow notifications for EasyWay in your phone's Settings, then come back.",
      action: null,
    };
  } else if (push.supported) {
    alerts = {
      text: "Off. Turn on to hear about classes, new material and results even when the app is closed.",
      action: (
        <button type="button" onClick={() => void push.enable()} disabled={push.busy} className={primary}>
          {push.busy ? "Turning on…" : "Turn on alerts"}
        </button>
      ),
    };
  } else if (push.needsInstall) {
    alerts = {
      text: "iPhone only sends alerts to apps on your Home Screen. Install EasyWay first, open it from the icon, then turn alerts on.",
      action: (
        <button type="button" onClick={requestInstall} className={primary}>
          Show me how
        </button>
      ),
    };
  } else if (push.iosTooOld) {
    alerts = {
      text: "Alerts on iPhone need iOS 16.4 or newer. Update in Settings › General › Software Update.",
      action: null,
    };
  } else {
    alerts = {
      text: "This browser can't receive alerts. Try Chrome or Safari, or install the app.",
      action: null,
    };
  }

  return (
    <section className="mx-auto mt-6 w-full max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">App &amp; alerts</p>
      <h2 className="mt-2 text-2xl font-black text-[var(--foreground)]">EasyWay on your phone</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Put EasyWay on your Home Screen to open it in one tap, read downloaded notes with no data, and get alerts on
        your lock screen.
      </p>

      <div className="mt-5 grid max-w-2xl gap-3">
        <div className={row}>
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 text-[var(--accent)]">
              {installed ? <CheckCircleIcon className="h-5 w-5" /> : <AddSquareIcon className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--foreground)]">{installed ? "App installed" : "Install the app"}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
                {installed
                  ? "You're using EasyWay from your Home Screen."
                  : "Add EasyWay to your Home Screen. We'll show you exactly where to tap."}
              </p>
            </div>
          </div>
          {installed ? null : (
            <button type="button" onClick={requestInstall} className={primary}>
              Install
            </button>
          )}
        </div>

        <div className={row}>
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 text-[var(--accent)]">
              {push.enabled ? <BellIcon className="h-5 w-5" /> : <BellOffIcon className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--foreground)]">Alerts</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{alerts.text}</p>
              {push.error ? <p className="mt-1 text-xs font-semibold text-red-600">{push.error}</p> : null}
            </div>
          </div>
          {alerts.action}
        </div>
      </div>
    </section>
  );
}
