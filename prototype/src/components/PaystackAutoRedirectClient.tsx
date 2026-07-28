"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson } from "@/lib/safe-json";

type Props = { reference?: string | null; source?: string | null };

export default function PaystackAutoRedirectClient({ reference, source }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function verifyAndRedirect(ref?: string) {
      if (!ref) return;
      try {
        setStatus("verifying");
        const resp = await fetch(`/api/paystack/verify?reference=${encodeURIComponent(ref)}`);
        const data = await safeJson(resp);
        if (resp.ok && data?.success) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("pendingPaystackReference");
            window.localStorage.removeItem("pendingPaystackAmount");
            window.localStorage.removeItem("pendingPaystackPathwayName");
            window.localStorage.setItem("paystackPaymentSuccess", "true");
          }
          if (mounted) router.replace("/dashboard?paymentRefresh=1");
          return;
        }

        const pending = typeof window !== "undefined" ? window.localStorage.getItem("pendingPaystackReference") : null;
        if (pending && pending !== ref) {
          await verifyAndRedirect(pending);
          return;
        }

        setStatus("failed");
      } catch (err) {
        console.error("Paystack verify client error:", err);
        setStatus("failed");
      }
    }

    if (reference) {
      verifyAndRedirect(reference);
    } else if (source === "paystack") {
      const pending = typeof window !== "undefined" ? window.localStorage.getItem("pendingPaystackReference") : null;
      if (pending) verifyAndRedirect(pending);
    }

    return () => {
      mounted = false;
    };
  }, [reference, source, router]);

  if (status === "verifying") {
    return <p className="mt-3 text-sm text-slate-600">Verifying payment and redirecting to dashboard…</p>;
  }

  if (status === "failed") {
    return <p className="mt-3 text-sm text-rose-600">We couldn't verify the transaction automatically. You can go to your dashboard to confirm payment.</p>;
  }

  return null;
}
