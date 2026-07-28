"use client";

import { useEffect, useState } from "react";

export default function PaymentSuccessToastClient() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const successFlag = window.localStorage.getItem("paystackPaymentSuccess");
    if (successFlag === "true") {
      window.localStorage.removeItem("paystackPaymentSuccess");
      setVisible(true);
      window.setTimeout(() => setVisible(false), 5000);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,450px)] -translate-x-1/2 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-xl shadow-emerald-500/10">
      <p className="font-semibold">Payment confirmed!</p>
      <p className="mt-1">Your Paystack payment was verified successfully. Welcome back to your dashboard.</p>
    </div>
  );
}
