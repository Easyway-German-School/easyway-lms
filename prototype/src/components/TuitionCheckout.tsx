"use client";
import { CheckIcon } from "@/components/icons";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { safeJson } from "@/lib/safe-json";
import type { FullPaymentOffer, Perk } from "@/lib/pay-in-full";

/**
 * The tuition checkout, arranged to move students from 60% to 100%.
 *
 * The order of the page is the argument. Anchor on the whole fee, shrink it to
 * a weekly figure, hand over the bundle of extras, show the gap the ring leaves
 * open, then — and only then, behind a quiet link — offer part-payment,
 * described by the debt it creates rather than the amount it settles.
 *
 * Every figure comes from `/api/student/tuition-offer`, which computes it from
 * the student's own level, branch and payment history. Nothing here is invented
 * for effect: the deadline is enforced, the branch statistic is real or absent,
 * and the consequences listed under part-payment are ones the code carries out.
 * See the mechanism list in `src/lib/pay-in-full.ts`.
 */

type OfferResponse = {
  level: string;
  branchName: string | null;
  sellable: boolean;
  requiredDeposit: number;
  offer: FullPaymentOffer;
  options: {
    full: { amount: number; headline: string; subline: string };
    deposit: { amount: number; headline: string; subline: string; available: boolean };
    windowNote: string;
  };
  socialProof: { percent: number; sample: number } | null;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString()}`;

export default function TuitionCheckout({ pathwayName }: { pathwayName: string }) {
  const [data, setData] = useState<OfferResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partPayOpen, setPartPayOpen] = useState(false);
  const [busy, setBusy] = useState<"full" | "deposit" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/tuition-offer", { cache: "no-store", credentials: "include" });
        const json = await safeJson(res);
        if (!res.ok || !json) throw new Error(json?.error || "Could not load your tuition figures");
        if (!cancelled) setData(json as OfferResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your tuition figures");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout(stage: "full" | "deposit") {
    setBusy(stage);
    setError(null);
    try {
      // Only the stage goes over the wire. The route prices it from the
      // student's own record, so the amount cannot be edited in devtools.
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathwayName, pathwayId: pathwayName, paymentStage: stage }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.authorization_url) {
        throw new Error(json?.error || "Unable to start checkout");
      }
      if (json.reference) {
        window.localStorage.setItem("pendingPaystackReference", String(json.reference));
        window.localStorage.setItem("pendingPaystackAmount", String(json.amount ?? ""));
        window.localStorage.setItem("pendingPaystackPathwayName", pathwayName);
      }
      window.location.href = json.authorization_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout");
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-[32px] border border-white/10 bg-[#0b1220] p-8 text-slate-300">
        Loading your tuition figures…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-[32px] border border-rose-400/30 bg-rose-950/40 p-8 text-rose-200">
        <p className="font-semibold">Tuition could not be loaded</p>
        <p className="mt-2 text-sm">{error ?? "Please refresh, or speak to your branch office."}</p>
      </div>
    );
  }

  const { offer, options, socialProof } = data;

  // Nothing to sell: either it is settled, or the level is quoted off-portal.
  if (offer.fullPaid) {
    return <SettledPanel offer={offer} level={data.level} branchName={data.branchName} />;
  }
  if (!data.sellable) {
    return (
      <div className="rounded-[32px] border border-amber-300/30 bg-amber-950/30 p-8 text-amber-100">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">{data.level} tuition</p>
        <h2 className="mt-3 text-2xl font-semibold">Your branch office quotes this level directly</h2>
        <p className="mt-3 text-sm text-amber-100/80">
          {data.level} is not on self-service checkout yet. Contact {data.branchName ?? "your branch"} to be
          invoiced, and it will appear on your Payments page once recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[32px] border border-[#c8a24a]/30 bg-gradient-to-b from-[#0b1220] via-[#0d1526] to-[#0b1220] shadow-[0_30px_80px_-40px_rgba(200,162,74,0.45)]">
      {/* ---- Anchor: the whole fee, then shrunk to a weekly figure ---- */}
      <div className="border-b border-white/10 px-8 pt-8 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-[#c8a24a]">
              Tuition · {data.level}
              {data.branchName ? ` · ${data.branchName}` : ""}
            </p>
            <p className="mt-3 font-serif text-5xl font-semibold tracking-tight text-white">
              {naira(offer.tuitionFee)}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              About {naira(offer.perWeek)} a week across {offer.weeksOfTeaching} weeks of teaching.
            </p>
          </div>
          <ProgressRing percent={offer.progressPercent} />
        </div>

        {offer.totalPaid > 0 ? (
          <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            {naira(offer.totalPaid)} received so far.{" "}
            <span className="font-semibold text-white">{naira(offer.outstanding)} still owing</span> —{" "}
            {offer.remainingPercent}% of your tuition.
          </p>
        ) : null}
      </div>

      {/* ---- The recommended path, laid out as the default ---- */}
      <div className="px-8 py-8">
        <div className="rounded-3xl border border-[#c8a24a]/50 bg-gradient-to-br from-[#141d33] to-[#0e1425] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center rounded-full bg-[#c8a24a] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#1a1206]">
                Recommended
              </span>
              <h3 className="mt-4 text-2xl font-semibold text-white">{options.full.headline}</h3>
              <p className="mt-2 max-w-md text-sm text-slate-400">{options.full.subline}</p>
            </div>
            <p className="font-serif text-4xl font-semibold text-[#e8cf8f]">{naira(options.full.amount)}</p>
          </div>

          {/* Bundling: itemised, and phrased as already allocated. */}
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {offer.perks.map((perk) => (
              <PerkRow key={perk.id} perk={perk} />
            ))}
          </ul>

          <button
            type="button"
            onClick={() => startCheckout("full")}
            disabled={busy !== null}
            className="mt-7 w-full rounded-2xl bg-[#c8a24a] px-6 py-4 text-lg font-bold text-[#1a1206] shadow-[0_10px_30px_-10px_rgba(200,162,74,0.8)] transition hover:-translate-y-0.5 hover:bg-[#d8b45f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "full" ? "Opening secure checkout…" : `Pay ${naira(options.full.amount)} in full`}
          </button>

          {/* A real deadline, stated in days and never restarted. */}
          <p className={`mt-4 text-center text-xs font-semibold uppercase tracking-[0.18em] ${offer.windowOpen ? "text-[#e8cf8f]" : "text-slate-500"}`}>
            {options.windowNote}
          </p>
        </div>

        {/* Real peer behaviour, or nothing at all. */}
        {socialProof ? (
          <p className="mt-6 text-center text-sm text-slate-400">
            <span className="font-semibold text-white">{socialProof.percent}%</span> of the {socialProof.sample}{" "}
            students at {data.branchName} have paid their tuition in full.
          </p>
        ) : null}

        {/* ---- Part-payment: available, but never the path of least resistance ---- */}
        {options.deposit.available ? (
          <div className="mt-8 border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={() => setPartPayOpen((open) => !open)}
              aria-expanded={partPayOpen}
              className="text-sm font-medium text-slate-400 underline decoration-slate-600 underline-offset-4 transition hover:text-slate-200"
            >
              {partPayOpen ? "Hide part-payment" : "I can only part-pay right now"}
            </button>

            <AnimatePresence initial={false}>
              {partPayOpen ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                    <p className="text-base font-semibold text-slate-200">{options.deposit.headline}</p>
                    <p className="mt-2 text-sm text-slate-400">{options.deposit.subline}</p>
                    <ul className="mt-4 space-y-2 text-sm text-slate-400">
                      <li>· Your certificate is stamped PROVISIONAL with the balance printed on it.</li>
                      <li>· Fee reminders begin after 14 days and escalate at 30 and 45.</li>
                      <li>· The {offer.perks.length} extras above are not included.</li>
                    </ul>
                    <button
                      type="button"
                      onClick={() => startCheckout("deposit")}
                      disabled={busy !== null}
                      className="mt-5 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === "deposit" ? "Opening…" : `Pay ${naira(options.deposit.amount)} and owe the rest`}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        {error ? (
          <p className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PerkRow({ perk }: { perk: Perk }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#c8a24a]" />
      <span>
        <span className="block text-sm font-medium text-slate-100">{perk.label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{perk.detail}</span>
      </span>
    </li>
  );
}

/**
 * Mechanism 3 — the gap is the message. Sized so an unfinished ring is
 * immediately legible at a glance rather than needing the number read.
 */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, percent));

  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#c8a24a"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - filled / 100) }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-2xl font-semibold text-white">{filled}%</span>
        <span className="text-[0.6rem] uppercase tracking-[0.16em] text-slate-500">paid</span>
      </div>
    </div>
  );
}

function SettledPanel({
  offer,
  level,
  branchName,
}: {
  offer: FullPaymentOffer;
  level: string;
  branchName: string | null;
}) {
  return (
    <div className="rounded-[32px] border border-emerald-400/30 bg-gradient-to-br from-emerald-950/60 to-[#0b1220] p-8">
      <p className="text-xs uppercase tracking-[0.32em] text-emerald-300">
        {level}
        {branchName ? ` · ${branchName}` : ""} · settled
      </p>
      <h2 className="mt-3 text-3xl font-semibold text-white">Tuition paid in full — {naira(offer.tuitionFee)}</h2>
      <p className="mt-3 text-sm text-emerald-100/70">
        Nothing further is owed for this level. Your certificate will be issued clean, with no provisional stamp.
      </p>
      {offer.bonusEarned ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {offer.perks.map((perk) => (
            <PerkRow key={perk.id} perk={perk} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
