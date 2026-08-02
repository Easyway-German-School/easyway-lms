"use client";

import { useEffect, useState } from "react";
import { useMoment } from "@/lib/moment-queue";

/**
 * "Your payment went through."
 *
 * First in the moment queue and the only one that is a toast rather than a
 * modal — see lib/moment-queue.tsx. Closure on an action somebody just took
 * occupies their whole attention until it is answered, so it is answered
 * before anything else is attempted; and because it asks for no decision, it
 * does not count against the two-modals-a-visit cap.
 */
export default function PaymentSuccessToastClient() {
  const [due, setDue] = useState(false);
  const { open, close } = useMoment("payment-success", due);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const successFlag = window.localStorage.getItem("paystackPaymentSuccess");
    if (successFlag === "true") {
      // Cleared immediately: the flag is a one-shot handoff from the Paystack
      // return, and leaving it set would re-announce the same payment on every
      // dashboard load until the next one.
      window.localStorage.removeItem("paystackPaymentSuccess");
      setDue(true);
    }
  }, []);

  // The five seconds start when it actually APPEARS, not when the flag is
  // read. A toast whose timer runs while it is queued behind something else
  // can expire before anybody has seen it.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setDue(false);
      close();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,450px)] -translate-x-1/2 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-xl shadow-emerald-500/10">
      <p className="font-semibold">Payment confirmed!</p>
      <p className="mt-1">Your Paystack payment was verified successfully. Welcome back to your dashboard.</p>
    </div>
  );
}
