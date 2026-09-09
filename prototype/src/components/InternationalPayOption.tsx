"use client";

import { useState } from "react";

import { safeJson } from "@/lib/safe-json";

/**
 * "Pay with an international card" — the opt-in Flutterwave path, shown beneath
 * the normal Paystack button on every checkout.
 *
 * Paystack stays the default and is untouched. This posts the SAME request body
 * to `/api/flutterwave/initialize` (which re-derives the amount server-side,
 * exactly as the Paystack route does) and forwards the student to Flutterwave's
 * hosted page. The Flutterwave webhook is the safety net: it records and
 * notifies even if the student never makes it back to the redirect page.
 */

type Props = {
  /** The JSON body to send — identical shape to the Paystack initialize call. */
  payload: Record<string, unknown>;
  /** Optional line above the button, e.g. "Paying from outside Nigeria?". */
  hint?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
};

export default function InternationalPayOption({
  payload,
  hint = "Paying from outside Nigeria?",
  label = "Pay with an international card",
  className,
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flutterwave/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await safeJson<{ link?: string; reference?: string; amount?: number; error?: string }>(res);
      if (!res.ok || !json?.link) {
        throw new Error(json?.error || "Could not start the international card checkout.");
      }
      try {
        if (json.reference) {
          window.localStorage.setItem("pendingFlutterwaveTxRef", String(json.reference));
          window.localStorage.setItem("pendingFlutterwaveAmount", String(json.amount ?? ""));
        }
      } catch {
        // Storage disabled — the webhook still records the payment.
      }
      window.location.href = json.link;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the international card checkout.");
      setBusy(false);
    }
  }

  return (
    <div className={className ?? "mt-3 text-center"}>
      {hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}
      <button
        type="button"
        onClick={start}
        disabled={busy || disabled}
        className="mt-1 text-sm font-medium text-[var(--muted)] underline decoration-[var(--border-strong)] underline-offset-4 transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Opening secure checkout…" : `${label} (Visa · Mastercard)`}
      </button>
      {error ? (
        <p className="mt-2 rounded-2xl border border-rose-400/30 bg-rose-950/30 px-4 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
