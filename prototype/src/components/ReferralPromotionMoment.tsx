"use client";

import { useEffect, useState } from "react";

import { recordReferralPromotionImpression } from "@/lib/referral-campaign";

type ReferralPromotionData = {
  referralCode: string | null;
  commissionPercent?: number | null;
  commissionFlat?: number | null;
  signups?: number;
  pendingCredit?: number;
  creditedTotal?: number;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

function rewardLine(data: ReferralPromotionData): string | null {
  const parts: string[] = [];
  if (data.commissionPercent) parts.push(`${data.commissionPercent}%`);
  if (data.commissionFlat) parts.push(naira(data.commissionFlat));
  if (!parts.length) return null;
  return `Earn ${parts.join(" + ")} credit toward your own tuition for every friend who joins.`;
}

export default function ReferralPromotionMoment() {
  const [data, setData] = useState<ReferralPromotionData | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;

    fetch("/api/student/referral-promotion", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ReferralPromotionData;
      })
      .then((result) => {
        if (!active || !result?.referralCode) return;
        try {
          if (!recordReferralPromotionImpression(result.referralCode, window.localStorage)) return;
        } catch {
          // Do not show repeatedly when daily frequency cannot be persisted.
          return;
        }
        setData(result);
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
    if (!data?.referralCode) return;
    const link = `${window.location.origin}/auth/signup?promo=${encodeURIComponent(data.referralCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!visible || !data?.referralCode) return null;
  const reward = rewardLine(data);
  const creditedTotal = data.creditedTotal ?? 0;
  const pendingCredit = data.pendingCredit ?? 0;

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

        <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-amber-700">Refer a friend</p>
        <h2 id="referral-promotion-title" className="mt-2 pr-8 text-2xl font-black leading-tight text-slate-950">
          Share your code. Earn credit.
        </h2>
        <p className="mt-2 text-sm font-medium text-slate-600">
          {reward ?? "Share your code with a friend — your school will confirm what you earn when they join."}
        </p>

        {creditedTotal > 0 || pendingCredit > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">Credited</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{naira(creditedTotal)}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-900">On the way</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{naira(pendingCredit)}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-100 p-3">
          <p className="text-xs text-slate-700">Your code: <strong className="font-mono text-slate-950">{data.referralCode}</strong></p>
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
