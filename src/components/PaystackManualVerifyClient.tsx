"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson } from "@/lib/safe-json";

/**
 * "Check again" for a reference that did not settle on its own.
 *
 * Reports three distinct outcomes rather than one. It used to answer every
 * non-success with "Unable to verify payment. Contact support if this
 * persists." — including the case where Paystack had confirmed the charge and
 * only our own recording had failed, which is the one case where telling a
 * student their payment could not be verified is actively wrong.
 */

type Outcome = null | "checking" | "paid" | "unpaid" | "unrecorded" | "unreachable" | "missing";

export default function PaystackManualVerifyClient({ reference }: { reference?: string | null }) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const router = useRouter();

  async function handleVerify() {
    if (!reference) {
      setOutcome("missing");
      return;
    }

    setOutcome("checking");

    try {
      const response = await fetch(`/api/paystack/verify?reference=${encodeURIComponent(reference)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await safeJson(response);

      if (response.ok && data?.paid) {
        window.localStorage.removeItem("pendingPaystackReference");
        window.localStorage.removeItem("pendingPaystackAmount");
        window.localStorage.removeItem("pendingPaystackPathwayName");
        setOutcome("paid");
        // A beat so the confirmation is readable before the page changes.
        setTimeout(() => router.replace("/dashboard?paymentRefresh=1"), 700);
        return;
      }

      // Paid, but our side still has not caught up — a different problem, and
      // one the student cannot fix by paying again.
      setOutcome(data?.persistFailed ? "unrecorded" : response.ok ? "unpaid" : "unreachable");
    } catch (error) {
      console.error("Manual verify error:", error);
      setOutcome("unreachable");
    }
  }

  const message: Record<Exclude<Outcome, null | "checking">, { text: string; tone: string }> = {
    paid: { text: "Payment confirmed — opening your dashboard.", tone: "text-[var(--success)]" },
    unpaid: { text: "Your bank has not confirmed this payment yet. Nothing has been charged twice.", tone: "text-[var(--muted)]" },
    unrecorded: {
      text: "Your payment is confirmed, but your account did not update. Send this reference to your branch office and they will apply it.",
      tone: "text-[var(--warning)]",
    },
    unreachable: { text: "We could not reach Paystack just now. Your payment is not affected — try again in a moment.", tone: "text-[var(--muted)]" },
    missing: { text: "No payment reference to check.", tone: "text-[var(--danger)]" },
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleVerify}
        disabled={outcome === "checking"}
        className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-alt)] px-5 py-2.5 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-60"
      >
        {outcome === "checking" ? "Checking…" : "Check again"}
      </button>

      {outcome && outcome !== "checking" ? (
        <p className={`mt-2 text-sm ${message[outcome].tone}`}>{message[outcome].text}</p>
      ) : null}
    </div>
  );
}
