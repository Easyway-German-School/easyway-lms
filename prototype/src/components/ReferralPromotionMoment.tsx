"use client";

import { useEffect, useState } from "react";

import { recordReferralPromotionImpression, REFERRAL_REWARD_COPY } from "@/lib/referral-campaign";

export default function ReferralPromotionMoment() {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/student/referral-promotion", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { referralCode?: string | null; campaignStatus?: string };
      })
      .then((data) => {
        if (!active || !data?.referralCode || data.campaignStatus !== "blocked") return;
        try {
          if (!recordReferralPromotionImpression(data.referralCode, window.localStorage)) return;
        } catch {
          // Do not show repeatedly when daily frequency cannot be persisted.
          return;
        }
        setReferralCode(data.referralCode);
        setVisible(true);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  function dismiss() {
    setVisible(false);
  }

  async function copyReferralLink() {
    if (!referralCode) return;
    const link = `${window.location.origin}/auth/signup?ref=${encodeURIComponent(referralCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!visible || !referralCode) return null;

  return (
    <aside className="fixed bottom-20 left-3 right-3 z-[100] sm:bottom-5 sm:left-auto sm:right-5 sm:w-[min(26rem,calc(100vw-2.5rem))]">
      <section
        aria-labelledby="referral-promotion-title"
        className="relative max-h-[72vh] overflow-y-auto rounded-3xl border border-amber-200 bg-white p-4 shadow-2xl sm:max-h-[80vh] sm:p-5"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close referral promotion"
          className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-2xl text-slate-500 hover:bg-slate-100"
        >
          ×
        </button>

        <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-amber-700">Referral rewards — planned</p>
        <h2 id="referral-promotion-title" className="mt-2 pr-8 text-2xl font-black leading-tight text-slate-950">
          Refer a friend. Save on your next tuition.
        </h2>
        <p className="mt-2 text-sm font-medium text-slate-600">
          Get tuition credit toward your next payment or level when someone joins through your link.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Pays in parts</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">₦10,000 + ₦5,000</p>
            <p className="mt-1 text-xs leading-5 text-slate-700">₦10,000 after their first payment, then ₦5,000 after they complete the balance.</p>
            <p className="mt-2 text-sm font-extrabold text-amber-900">₦15,000 total</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">Pays all at once</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-slate-950">₦20,000</p>
            <p className="mt-1 text-xs leading-5 text-slate-700">When your friend pays their full tuition in one payment.</p>
          </div>
        </div>

        <p className="mt-3 rounded-xl bg-slate-100 p-3 text-xs font-semibold leading-5 text-slate-700">
          {REFERRAL_REWARD_COPY.example}
        </p>

        <div className="mt-4 rounded-2xl border-2 border-rose-200 bg-rose-50 p-4">
          <p className="font-extrabold text-rose-950">Not live yet — please note</p>
          <p className="mt-1 text-xs leading-5 text-rose-900">{REFERRAL_REWARD_COPY.fulfillment}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-100 p-3">
          <p className="text-xs text-slate-700">Your code: <strong className="font-mono text-slate-950">{referralCode}</strong></p>
          <button
            type="button"
            onClick={() => void copyReferralLink()}
            className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
        >
          Skip for now
        </button>
      </section>
    </aside>
  );
}
