"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

/**
 * Where Paystack returns after an exam fee is paid.
 *
 * Verification also happens on the webhook, so this page is a confirmation
 * for the person rather than the thing that records the money. If they close
 * the tab before it loads, the seat is still settled.
 */

function PaidContent() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref") ?? "";

  const [state, setState] = useState<"checking" | "paid" | "failed">("checking");
  const [amount, setAmount] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!reference) {
      setState("failed");
      setMessage("No payment reference was provided.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/exam-centre/pay?reference=${encodeURIComponent(reference)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok && data.paid) {
          setAmount(data.amount ?? null);
          setState("paid");
        } else {
          setState("failed");
          setMessage(data.error ?? "That payment could not be confirmed.");
        }
      } catch {
        setState("failed");
        setMessage("We could not reach the payment service.");
      }
    })();
  }, [reference]);

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <BrandLogo variant="wordmark" className="h-10" />

      {state === "checking" && (
        <p className="mt-8 text-sm text-[var(--muted)]">Confirming your payment…</p>
      )}

      {state === "paid" && (
        <div className="mt-8 rounded-2xl bg-emerald-50 p-6">
          <p className="text-sm font-bold text-emerald-800">Payment received</p>
          <p className="mt-2 text-sm text-[var(--success)]">
            {amount !== null && `₦${amount.toLocaleString()} received. `}
            Your seat is confirmed and a receipt is on its way.
          </p>
          <Link href="/exams" className="mt-4 inline-block rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
            View my exams
          </Link>
        </div>
      )}

      {state === "failed" && (
        <div className="mt-8 rounded-2xl bg-red-50 p-6">
          <p className="text-sm font-bold text-red-800">Payment not confirmed</p>
          <p className="mt-2 text-sm text-red-700">{message}</p>
          <p className="mt-2 text-xs text-red-700">
            If money left your account, do not pay again — contact the branch office with your
            reference and it will be reconciled.
          </p>
        </div>
      )}
    </div>
  );
}

export default function ExamPaidPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <PaidContent />
    </Suspense>
  );
}
