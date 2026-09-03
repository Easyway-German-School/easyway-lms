"use client";

import { useEffect, useState } from "react";

import { safeJson } from "@/lib/safe-json";
import { naira, type LevelAdvanceOffer } from "@/lib/level-advance";

/**
 * Checkout for a student paying for the level after the one they just
 * finished — reached from "Continue to {nextLevel}" on the level-advance
 * offer, never picked from a menu.
 *
 * Deliberately NOT the pay-in-full checkout (`TuitionCheckout.tsx`). That
 * page's bonus-window psychology is built for a brand-new student's first 14
 * days after signing up — reusing it here would measure the window from the
 * student's original registration date, which for a returning student has
 * long since closed, and would show the perks/social-proof bundle as
 * forfeited before they have paid anything toward this level. The honest
 * balance disclosure and perks for continuing already live in the
 * LevelAdvance offer itself; this page just needs to take the payment.
 */

type Stage = "deposit" | "full";

export default function NextLevelCheckout() {
  const [offer, setOffer] = useState<LevelAdvanceOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Stage | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/advance", { cache: "no-store" });
        const json = await safeJson(res);
        if (!res.ok || !json?.offer) throw new Error(json?.error || "Could not load your level details");
        if (!cancelled) setOffer(json.offer as LevelAdvanceOffer);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load your level details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout(stage: Stage) {
    setBusy(stage);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStage: stage, forNextLevel: true }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.authorization_url) {
        throw new Error(json?.error || "Unable to start checkout");
      }
      if (json.reference) {
        window.localStorage.setItem("pendingPaystackReference", String(json.reference));
        window.localStorage.setItem("pendingPaystackAmount", String(json.amount ?? ""));
      }
      window.location.href = json.authorization_url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Unable to start checkout");
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--muted)]">
        Loading your level details…
      </div>
    );
  }

  if (!offer || loadError) {
    return (
      <div className="rounded-[32px] border border-rose-300 bg-rose-50 p-8 text-rose-800">
        <p className="font-semibold">Could not load this checkout</p>
        <p className="mt-2 text-sm">{loadError ?? "Please refresh, or speak to your branch office."}</p>
      </div>
    );
  }

  if (!offer.eligible || offer.atTopOfLadder || !offer.nextLevel) {
    return (
      <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--foreground)]">
        <p className="font-semibold">There is nothing to continue to right now.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This checkout only opens once your branch has signed off your current level. If you believe that has
          already happened, check your dashboard or ask your branch office.
        </p>
      </div>
    );
  }

  if (!offer.sellableOnline) {
    return (
      <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--foreground)]">
        <p className="font-semibold">{offer.nextLevel} is quoted by your branch office.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Contact {offer.branchName || "your branch"} to be invoiced — it will appear on your Payments page once
          recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
      <div className="border-b border-[var(--border)] px-8 pt-8 pb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
          Continuing to {offer.nextLevel}
          {offer.branchName ? ` · ${offer.branchName}` : ""}
        </p>
        <p className="mt-3 text-4xl font-bold text-[var(--foreground)]">{naira(offer.tuitionFee)}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {offer.weeksOfTeaching} weeks of teaching, same class rhythm you already know.
        </p>
      </div>

      <div className="space-y-4 p-8">
        {offer.currentLevelOutstanding > 0 ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              {naira(offer.currentLevelOutstanding)} is still open on {offer.currentLevel}.
            </p>
            <p className="mt-1">
              Paying here clears that first, then your {offer.nextLevel} amount — so you would pay{" "}
              <strong>{naira(offer.currentLevelOutstanding + offer.requiredDeposit)}</strong> for the deposit option, or{" "}
              <strong>{naira(offer.currentLevelOutstanding + offer.tuitionFee)}</strong> to settle {offer.nextLevel} in full.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => startCheckout("full")}
          disabled={busy !== null}
          className="w-full rounded-2xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "full"
            ? "Opening secure checkout…"
            : `Pay ${naira(offer.currentLevelOutstanding + offer.tuitionFee)}${offer.currentLevelOutstanding > 0 ? "" : " in full"}`}
        </button>

        <button
          type="button"
          onClick={() => startCheckout("deposit")}
          disabled={busy !== null}
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-6 py-4 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "deposit"
            ? "Opening…"
            : `Pay ${naira(offer.currentLevelOutstanding + offer.requiredDeposit)} deposit and start class now`}
        </button>

        {checkoutError ? (
          <p className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{checkoutError}</p>
        ) : null}
      </div>
    </div>
  );
}
