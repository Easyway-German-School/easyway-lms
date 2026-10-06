"use client";

import { useCallback, useEffect, useState } from "react";
import { isInstalledApp } from "@/lib/client/standalone";
import { currentInstallEnv } from "@/lib/client/platform";

/**
 * Browser side of Web Push: register the service worker, ask permission once,
 * and keep the subscription in sync with the server.
 *
 * Permission is never requested on page load — browsers penalise that and
 * students reflexively hit "Block", which is unrecoverable without digging
 * through site settings. It is only requested from an explicit tap.
 */

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushState = {
  supported: boolean;
  /**
   * iPhone/iPad in a normal browser tab. Apple only exposes Web Push to a site
   * opened from the Home Screen, so `supported` is false here NOT because the
   * device can't do alerts but because the app isn't installed yet. UI should
   * offer "install to get alerts" rather than hide the feature.
   */
  needsInstall: boolean;
  /** iOS older than 16.4: no Web Push exists at all, installing won't help. */
  iosTooOld: boolean;
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
  busy: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  error: string | null;
};

export function usePushNotifications(): PushState {
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [iosTooOld, setIosTooOld] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setSupported(ok);
    if (typeof window !== "undefined") {
      const env = currentInstallEnv();
      setIosTooOld(env.ios && env.iosTooOldForPush);
      setNeedsInstall(env.ios && !env.iosTooOldForPush && !isInstalledApp() && !ok);
    }
    if (!ok) return;

    setPermission(Notification.permission);

    // Reflect an existing subscription so the toggle shows the true state.
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(Boolean(sub)))
      .catch(() => {
        /* Registration fails on http:// origins other than localhost. */
      });
  }, []);

  const enable = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);

    try {
      // FIRST, and before any `await`: iOS Safari only honours
      // requestPermission() while the tap that caused it is still the current
      // user gesture. The old order fetched the VAPID config first, and on a
      // slow phone connection that network round trip used the gesture up —
      // iOS then resolves the request as "denied" without ever showing the
      // prompt, which reads to the student as "the button does nothing".
      const permissionRequest = Notification.requestPermission();
      const result = await permissionRequest;
      setPermission(result);
      if (result !== "granted") {
        throw new Error("Notifications were blocked. You can turn them on in Settings > Notifications > EasyWay.");
      }

      const config = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!config.configured || !config.publicKey) {
        throw new Error("Notifications aren't configured on the server yet.");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Reuse an existing subscription; creating a second one for the same
      // registration throws in Chrome.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        }));

      const raw = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: raw.endpoint,
          keys: raw.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("Could not save your notification settings.");

      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn on notifications.");
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  const disable = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setEnabled(false);
    } catch {
      setError("Could not turn off notifications.");
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  return { supported, needsInstall, iosTooOld, permission, enabled, busy, enable, disable, error };
}
