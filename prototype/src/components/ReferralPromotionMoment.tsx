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

/**
 * The actual sell — concrete cash, not "your school will confirm what you
 * earn." Every student referral code now ships with a real commissionFlat
 * from the moment it's created (see DEFAULT_STUDENT_REFERRAL_COMMISSION_FLAT
 * in lib/promo-pricing.ts), so this almost always has a real figure; the
 * generic fallback only shows for an account from before that shipped.
 */
function rewardLine(data: ReferralPromotionData): string {
  const parts: string[] = [];
  if (data.commissionPercent) parts.push(`${data.commissionPercent}% of their tuition`);
  if (data.commissionFlat) parts.push(naira(data.commissionFlat));
  if (!parts.length) return "Cash back on your own tuition for every friend who joins and pays.";
  return `You get ${parts.join(" + ")} cash back on your own tuition — paid out the moment they pay theirs.`;
}

export default function ReferralPromotionMoment() {
  const [data, setData] = useState<ReferralPromotionData | null>(null);
  const [visible, setVisible] = useState(false);
  const [shared, setShared] = useState(false);

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

  function referralLink(code: string): string {
    return `${window.location.origin}/auth/signup?promo=${encodeURIComponent(code)}`;
  }

  /**
   * A link, not a code — nobody reads a 30-character string aloud or types
   * it into WhatsApp by hand. The native share sheet is the whole point on
   * a phone: one tap straight into WhatsApp/Instagram/SMS, which is how
   * this actually gets shared. Clipboard copy is the fallback for a
   * browser with no share sheet, not the primary path.
   */
  async function shareReferralLink() {
    if (!data?.referralCode) return;
    const link = referralLink(data.referralCode);
    const shareData = { title: "Join me at EasyWay German Language School", text: "Learn German with me — sign up with my link:", url: link };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setShared(true);
        return;
      } catch {
        // User cancelled the share sheet — not an error, just no-op.
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setShared(true);
    } catch {
      setShared(false);
    }
  }

  if (!visible || !data?.referralCode) return null;
  const creditedTotal = data.creditedTotal ?? 0;
  const pendingCredit = data.pendingCredit ?? 0;
  const canNativeShare = typeof navigator !== "undefined" && Boolean(navigator.share);

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
          Bring a friend, get paid.
        </h2>
        <p className="mt-2 text-sm font-medium text-slate-600">{rewardLine(data)}</p>

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

        <button
          type="button"
          onClick={() => void shareReferralLink()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3.5 text-base font-black text-slate-950 shadow-lg shadow-amber-500/30 hover:bg-amber-400"
        >
          {shared ? (canNativeShare ? "Shared!" : "Link copied — paste it anywhere") : canNativeShare ? "Share my referral link" : "Copy my referral link"}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          WhatsApp status, your group chat, a DM — wherever your people are.
        </p>

        <button
          type="button"
          onClick={dismiss}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
        >
          Maybe later
        </button>
      </section>
    </aside>
  );
}
