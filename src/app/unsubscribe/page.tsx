"use client";

export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";

/**
 * Landing page for the unsubscribe link in email footers.
 *
 * No sign-in required, and the actual unsubscribe happens on a button press
 * rather than on page load — mail clients and security scanners prefetch
 * links, and a GET that unsubscribes would fire the moment the mail is opened.
 */

function UnsubscribeContent() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to unsubscribe");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <BrandLogo variant="wordmark" className="h-10" />

      <h1 className="mt-8 text-2xl font-bold">Email preferences</h1>

      {done ? (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-800">You have been unsubscribed.</p>
          <p className="mt-2 text-sm text-emerald-700">
            We will not send further non-essential email to {email}. Messages about your payments,
            exam registrations and account will still reach you.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Unsubscribe <span className="font-semibold">{email || "this address"}</span> from
            newsletters and class announcements?
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Essential mail about your payments, exam registrations and account will still be sent.
          </p>

          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button
            onClick={confirm}
            disabled={busy || !email || !token}
            className="mt-6 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Updating…" : "Unsubscribe"}
          </button>
        </>
      )}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <UnsubscribeContent />
    </Suspense>
  );
}
