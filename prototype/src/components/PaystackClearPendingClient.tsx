"use client";

import { useEffect } from "react";

/**
 * Clears the pending-payment breadcrumbs from localStorage.
 *
 * Rendered on the Paystack return page for every TERMINAL non-success outcome
 * (abandoned / failed / reversed). Without it, `pendingPaystackReference` stays
 * behind after a checkout the student walked away from, and the dashboard shows
 * a "payment processing" band for a payment that will never arrive — a support
 * ticket waiting to happen. `syncPendingPayment` on the dashboard only clears
 * these on a CONFIRMED payment, so a dead reference otherwise lives forever.
 */
export default function PaystackClearPendingClient() {
  useEffect(() => {
    try {
      window.localStorage.removeItem("pendingPaystackReference");
      window.localStorage.removeItem("pendingPaystackAmount");
      window.localStorage.removeItem("pendingPaystackPathwayName");
    } catch {
      /* storage disabled — nothing to clear */
    }
  }, []);

  return null;
}
