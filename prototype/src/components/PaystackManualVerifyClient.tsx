"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeJson } from "@/lib/safe-json";

export default function PaystackManualVerifyClient({ reference }: { reference?: string | null }) {
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function handleVerify() {
    if (!reference) {
      setStatus("missing");
      return;
    }
    try {
      setStatus("verifying");
      const resp = await fetch(`/api/paystack/verify?reference=${encodeURIComponent(reference)}`);
      const data = await safeJson(resp);
      if (resp.ok && data?.success) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("pendingPaystackReference");
          window.localStorage.removeItem("pendingPaystackAmount");
          window.localStorage.removeItem("pendingPaystackPathwayName");
        }
        setStatus("success");
        // small delay to let the user read the success message, then redirect
        setTimeout(() => router.replace("/dashboard?paymentRefresh=1"), 600);
        return;
      }
      setStatus("failed");
    } catch (err) {
      console.error("Manual verify error:", err);
      setStatus("failed");
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleVerify}
        className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm"
      >
        Verify payment now
      </button>
      {status === "verifying" ? <p className="mt-2 text-sm text-slate-600">Checking payment...</p> : null}
      {status === "success" ? <p className="mt-2 text-sm text-emerald-700">Payment verified — redirecting to dashboard.</p> : null}
      {status === "failed" ? <p className="mt-2 text-sm text-rose-600">Unable to verify payment. Contact support if this persists.</p> : null}
      {status === "missing" ? <p className="mt-2 text-sm text-rose-600">No payment reference found.</p> : null}
    </div>
  );
}
