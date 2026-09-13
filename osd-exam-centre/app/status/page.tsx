"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

/**
 * useSearchParams() opts a page out of static rendering unless it's inside a
 * Suspense boundary — without this split, `next build` fails prerendering
 * this page outright rather than just warning.
 */
export default function StatusPage() {
  return (
    <Suspense>
      <StatusPageInner />
    </Suspense>
  );
}

function StatusPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Landed here from the Flutterwave card-payment redirect (see
  // app/api/card-payment/callback/route.ts) — it can't know the reference
  // code without the candidate typing it in, so it sends them here instead
  // of failing silently.
  const paymentCancelled = params.get("paymentCancelled") === "1";
  const paymentError = params.get("paymentError") === "1";

  async function check() {
    setChecking(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(reference.trim())}?email=${encodeURIComponent(email.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Booking not found");
      }
      router.push(`/booking/${reference.trim()}?email=${encodeURIComponent(email.trim())}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking not found");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Check your booking</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">Enter the reference code from your confirmation email, and the email address you booked with.</p>

        {paymentCancelled && (
          <p className="mt-4 rounded-sm bg-[var(--gold-soft)] px-4 py-3 text-sm text-[var(--navy)]">
            Your card payment was cancelled — your booking is still held. Look it up below to try again.
          </p>
        )}
        {paymentError && (
          <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">
            We couldn't confirm that card payment. If you were charged, contact the office with your reference —
            look it up below and use "Need help?" once you're on your booking page.
          </p>
        )}
        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Reference code</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
              placeholder="EW-OSD-2026-XXXXX"
              className="mt-1.5 w-full rounded-sm border border-[var(--line)] px-3 py-2.5 text-sm uppercase focus:border-[var(--navy)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-sm border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--navy)] focus:outline-none"
            />
          </label>
          <button
            onClick={check}
            disabled={!reference.trim() || !email.trim() || checking}
            className="w-full rounded-sm bg-[var(--navy)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {checking ? "Checking…" : "View my booking"}
          </button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
