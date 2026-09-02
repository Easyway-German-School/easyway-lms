"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The bridge from Paystack's return page to the dashboard, on the happy path.
 *
 * The success screen used to be a bare server-side `redirect("/dashboard")`.
 * That worked, but a server redirect cannot touch localStorage, and two things
 * that live there were left on the floor:
 *
 *  - the "Payment confirmed" toast fires off a `paystackPaymentSuccess` flag
 *    that ONLY the client recovery paths (poll / manual verify) were setting.
 *    A student whose card cleared first time — the common case — was redirected
 *    with no acknowledgement at all.
 *  - the pending-payment breadcrumbs (`pendingPaystackReference` and friends)
 *    are what the dashboard reads to show a "payment processing" band. Left
 *    set, a settled payment keeps looking in-flight until the next hard reload.
 *
 * So the last step runs on the client for the one beat it takes to set the
 * flag, clear the breadcrumbs and move on.
 */
export default function PaystackSuccessRedirect() {
  const router = useRouter();

  useEffect(() => {
    try {
      window.localStorage.setItem("paystackPaymentSuccess", "true");
      window.localStorage.removeItem("pendingPaystackReference");
      window.localStorage.removeItem("pendingPaystackAmount");
      window.localStorage.removeItem("pendingPaystackPathwayName");
    } catch {
      // Private mode / storage disabled — the toast is a nicety, not load-
      // bearing, and the payment is already recorded server-side.
    }

    router.replace("/dashboard?paymentRefresh=1");

    // Belt and braces: if the client navigation stalls (slow hydration on a
    // weak connection is exactly the situation this whole flow exists for),
    // fall back to a full navigation so nobody is stranded on this page.
    const fallback = window.setTimeout(() => {
      window.location.href = "/dashboard?paymentRefresh=1";
    }, 2500);
    return () => window.clearTimeout(fallback);
  }, [router]);

  return null;
}
