"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export default function StatusPage() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

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
