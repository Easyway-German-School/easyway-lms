"use client";

import { useEffect, useState } from "react";
import { safeJson } from "@/lib/safe-json";
import { naira, type LevelAdvanceOffer } from "@/lib/level-advance";

export default function RetakeCheckout() {
  const [offer, setOffer] = useState<LevelAdvanceOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/advance", { cache: "no-store" });
        const json = await safeJson(res);
        if (!res.ok || !json?.offer) {
          throw new Error(json?.error || "Could not load your retake price.");
        }
        if (!cancelled) setOffer(json.offer as LevelAdvanceOffer);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load your retake price.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forRetake: true, paymentStage: "full" }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.authorization_url) {
        throw new Error(json?.error || "Unable to start secure checkout.");
      }
      if (json.reference) {
        window.localStorage.setItem("pendingPaystackReference", String(json.reference));
        window.localStorage.setItem("pendingPaystackAmount", String(json.amount ?? ""));
      }
      window.location.assign(json.authorization_url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start secure checkout.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--muted)]" aria-live="polite">
        Loading your retake price…
      </div>
    );
  }

  if (!offer?.eligible || !offer.retakeTuition) {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <h2 className="text-lg font-bold text-[var(--foreground)]">Retake checkout isn’t available yet</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This option opens after your branch signs off your current level. If it has already been signed off, contact your branch office.
        </p>
      </div>
    );
  }

  const retake = offer.retakeTuition;

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
      <header className="bg-gradient-to-br from-[#0D7C7E] to-[#155e75] px-7 py-7 text-white sm:px-9">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/75">Repeat a completed level</p>
        <h2 className="mt-2 text-2xl font-bold">Retake {offer.currentLevel}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">
          Your repeat tuition is discounted by 30%. The amount is based on your current branch and study pathway.
        </p>
      </header>

      <div className="space-y-5 p-7 sm:p-9">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Current tuition</p>
            <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{naira(retake.baseFee)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-800">30% retake discount</p>
            <p className="mt-1 text-lg font-semibold text-emerald-900">−{naira(retake.discountAmount)}</p>
          </div>
          <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">You pay</p>
            <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{naira(retake.fee)}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={startCheckout}
          disabled={busy}
          className="w-full rounded-2xl bg-[var(--accent)] px-6 py-4 text-base font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Opening secure checkout…" : `Pay ${naira(retake.fee)} securely`}
        </button>
        {error ? (
          <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
        <p className="text-center text-xs text-[var(--muted)]">
          Your final amount is checked against the live price book before payment starts.
        </p>
      </div>
    </section>
  );
}
