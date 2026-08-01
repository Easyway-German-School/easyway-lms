"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson } from "@/lib/safe-json";

/**
 * Re-checks a Paystack reference from the browser and moves the student on once
 * it clears.
 *
 * Two things it must get right, both of which it used to get wrong:
 *
 * - It redirected on `data.success`, which only ever meant "Paystack answered".
 *   A pending bank transfer answers perfectly well, so a student whose money had
 *   not landed yet was sent to a dashboard with nothing unlocked. It now waits
 *   for `data.paid`.
 * - With `poll`, it keeps checking. A bank transfer or USSD charge settles on
 *   its own schedule, and a single check the instant the page loads is the one
 *   moment it is least likely to have cleared.
 */

type Props = {
  reference?: string | null;
  source?: string | null;
  /** Keep checking until it clears or the attempts run out. */
  poll?: boolean;
};

const POLL_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 24; // ~2 minutes, then stop and let them act.

export default function PaystackAutoRedirectClient({ reference, source, poll = false }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "checking" | "waiting" | "gaveup">("idle");
  const attempts = useRef(0);

  const clearPending = useCallback(() => {
    window.localStorage.removeItem("pendingPaystackReference");
    window.localStorage.removeItem("pendingPaystackAmount");
    window.localStorage.removeItem("pendingPaystackPathwayName");
  }, []);

  useEffect(() => {
    const ref = reference || (source === "paystack" ? window.localStorage.getItem("pendingPaystackReference") : null);
    if (!ref) return;

    let cancelled = false;
    let timer: number | undefined;

    async function check() {
      attempts.current += 1;
      if (!cancelled) setStatus("checking");

      try {
        const response = await fetch(`/api/paystack/verify?reference=${encodeURIComponent(ref!)}`, {
          cache: "no-store",
          credentials: "include",
        });
        const data = await safeJson(response);

        if (!cancelled && response.ok && data?.paid) {
          clearPending();
          window.localStorage.setItem("paystackPaymentSuccess", "true");
          router.replace("/dashboard?paymentRefresh=1");
          return;
        }
      } catch (error) {
        console.error("Paystack verify client error:", error);
      }

      if (cancelled) return;

      if (!poll || attempts.current >= MAX_ATTEMPTS) {
        setStatus("gaveup");
        return;
      }

      setStatus("waiting");
      timer = window.setTimeout(check, POLL_INTERVAL_MS);
    }

    check();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [reference, source, poll, router, clearPending]);

  if (status === "gaveup") {
    return (
      <p className="mt-4 text-center text-sm text-[var(--muted)]">
        Still not confirmed. Your payment is not affected — reload this page later, or check your payments list.
      </p>
    );
  }

  if (status === "checking" || status === "waiting") {
    return (
      <p className="mt-4 text-center text-sm text-[var(--muted)]">
        Checking with your bank… ({attempts.current}/{MAX_ATTEMPTS})
      </p>
    );
  }

  return null;
}
