"use client";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useMoment } from "@/lib/moment-queue";
import {
  advanceHeadline,
  advanceSubheading,
  naira,
  type LevelAdvanceOffer,
} from "@/lib/level-advance";

/**
 * The moment a level ends.
 *
 * A student who finishes A1 and hears nothing just stops coming — this is where
 * the school keeps them or loses them. So it gets two surfaces, not one:
 *
 *   - a full-screen moment, once per level, that treats finishing as an
 *     achievement before it mentions money;
 *   - a card that stays on the dashboard afterwards, because one dismissed
 *     modal must not be the only chance to convert.
 *
 * Nothing here invents a discount or a deadline. The price is the price table's
 * price, and the balance still open on the finished level is shown rather than
 * hidden — a student told to "continue to A2" who then hits an unpaid A1
 * balance at the counter trusts nothing else the portal says.
 */

function LevelBadge({ level, tone = "next" }: { level: string; tone?: "current" | "next" }) {
  return (
    <div
      className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-xl font-bold ${
        tone === "next"
          ? "bg-gradient-to-br from-[#0D7C7E] to-[#FF6600] text-white shadow-lg shadow-[#FF6600]/25"
          : "border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--muted)]"
      }`}
    >
      {level}
    </div>
  );
}

function PriceBlock({ offer }: { offer: LevelAdvanceOffer }) {
  if (offer.atTopOfLadder) return null;

  // Two figures, not three. The third was a per-week breakdown ("₦18,750/wk"),
  // which EasyWay does not sell — nobody can pay weekly, so quoting a weekly
  // number invites a question the office has to talk students back out of.
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { label: `${offer.nextLevel} tuition`, value: naira(offer.tuitionFee), hint: `at ${offer.branchName || "your branch"}` },
        { label: "To start class", value: naira(offer.requiredDeposit), hint: "the deposit, not the full fee" },
      ].map((item) => (
        <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{item.label}</p>
          <p className="mt-1.5 text-xl font-bold text-[var(--foreground)]">{item.value}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{item.hint}</p>
        </div>
      ))}
    </div>
  );
}

function OutstandingNotice({ offer }: { offer: LevelAdvanceOffer }) {
  if (offer.currentLevelOutstanding <= 0) return null;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">
        {naira(offer.currentLevelOutstanding)} is still open on {offer.currentLevel}
      </p>
      <p className="mt-1">
        Clear it and your place in {offer.nextLevel} is confirmed. We are telling you now rather than at the counter.
      </p>
    </div>
  );
}

function Perks({ offer, animate }: { offer: LevelAdvanceOffer; animate?: boolean }) {
  if (offer.atTopOfLadder) return null;
  return (
    <ul className="space-y-2.5">
      {offer.perks.map((perk, index) => (
        <motion.li
          key={perk.label}
          initial={animate ? { opacity: 0, x: -12 } : false}
          animate={animate ? { opacity: 1, x: 0 } : undefined}
          transition={{ delay: 0.5 + index * 0.12, duration: 0.4 }}
          className="flex gap-3"
        >
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700">
            <CheckIcon className="h-3 w-3" strokeWidth={3} />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">{perk.label}</p>
            <p className="text-xs leading-5 text-[var(--muted)]">{perk.detail}</p>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}

/** Where "continue" sends them: settle the old balance first, or buy the next level. */
function primaryAction(offer: LevelAdvanceOffer) {
  if (offer.atTopOfLadder) return { href: "/exam-centre", label: "Register for your exam" };
  if (offer.currentLevelOutstanding > 0) return { href: "/payments", label: `Clear ${naira(offer.currentLevelOutstanding)} first` };
  if (!offer.sellableOnline) return { href: "/notifications", label: `Ask the office about ${offer.nextLevel}` };
  return { href: "/programs", label: `Continue to ${offer.nextLevel}` };
}

function CelebrationModal({ offer, onClose }: { offer: LevelAdvanceOffer; onClose: () => void }) {
  const action = primaryAction(offer);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // `items-start`, not `items-center`. Centring a flex child that is taller
      // than the scroll container pushes its top above the scrollable area,
      // where no amount of scrolling reaches it — on a laptop viewport that hid
      // the entire celebration header, which is the part doing the work.
      // Auto margins re-centre it whenever it does fit.
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={advanceHeadline(offer)}
    >
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="relative my-auto w-full max-w-2xl overflow-hidden rounded-[32px] bg-[var(--surface)] py-0 shadow-2xl"
      >
        {/* The celebration band. Money is deliberately below the fold of this
            block — finishing a level is an achievement first. */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-8 py-9 text-white">
          {[0, 1, 2].map((ring) => (
            <motion.div
              key={ring}
              aria-hidden
              initial={{ scale: 0.4, opacity: 0.5 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 2.4, delay: ring * 0.7, repeat: Infinity, ease: "easeOut" }}
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-white/40"
            />
          ))}

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-xs font-semibold uppercase tracking-[0.3em] text-white/75"
          >
            {offer.atTopOfLadder ? "You reached the top" : "Level complete"}
          </motion.p>

          <div className="mt-4 flex items-center gap-4">
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 }}>
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/15 text-xl font-bold backdrop-blur">
                {offer.currentLevel}
              </div>
            </motion.div>

            {!offer.atTopOfLadder && offer.nextLevel ? (
              <>
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-white/70"
                >
                  <ArrowRightIcon className="h-6 w-6" />
                </motion.span>
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.55, type: "spring", stiffness: 300, damping: 18 }}
                >
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-xl font-bold text-[#0D7C7E] shadow-lg">
                    {offer.nextLevel}
                  </div>
                </motion.div>
              </>
            ) : null}
          </div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-5 text-2xl font-bold leading-tight sm:text-3xl"
          >
            {advanceHeadline(offer)}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="mt-2 max-w-xl text-sm leading-6 text-white/85"
          >
            {advanceSubheading(offer)}
          </motion.p>
        </div>

        <div className="space-y-5 p-7">
          <OutstandingNotice offer={offer} />
          <PriceBlock offer={offer} />
          <Perks offer={offer} animate />

          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <Link
              href={action.href}
              onClick={onClose}
              className="flex-1 rounded-full bg-[var(--accent)] px-6 py-3.5 text-center text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            >
              {action.label}
            </Link>
            <button
              onClick={onClose}
              className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              Not right now
            </button>
          </div>
          <p className="text-center text-xs text-[var(--muted)]">
            This stays on your dashboard — closing it does not lose your place.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The card that lives on the dashboard once the modal has been dismissed. */
function AdvanceCard({ offer, onOpen }: { offer: LevelAdvanceOffer; onOpen: () => void }) {
  const action = primaryAction(offer);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-3xl border border-[var(--accent)]/25 bg-[var(--surface)] shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-[var(--accent-soft)] to-transparent px-6 py-5">
        <LevelBadge level={offer.currentLevel} tone="current" />
        {!offer.atTopOfLadder && offer.nextLevel ? (
          <>
            <ArrowRightIcon className="h-5 w-5 text-[var(--muted)]" />
            <LevelBadge level={offer.nextLevel} />
          </>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            {offer.atTopOfLadder ? "Ladder complete" : "Ready for the next level"}
          </p>
          <h3 className="mt-1 text-lg font-bold text-[var(--foreground)]">{advanceHeadline(offer)}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{advanceSubheading(offer)}</p>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <OutstandingNotice offer={offer} />
        <PriceBlock offer={offer} />
        <div className="flex flex-wrap gap-3">
          <Link
            href={action.href}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
          >
            {action.label}
          </Link>
          {!offer.atTopOfLadder ? (
            <button
              onClick={onOpen}
              className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
            >
              What do I get?
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

export default function LevelAdvance({ className = "" }: { className?: string }) {
  const [offer, setOffer] = useState<LevelAdvanceOffer | null>(null);
  const [due, setDue] = useState(false);
  /** Opened by tapping the card. A deliberate open jumps every queue there is. */
  const [manual, setManual] = useState(false);

  // Fourth in the moment queue. It is news about THEM, which outranks anything
  // about us — but it sits behind orientation, because a celebration you
  // cannot place is confusing rather than pleasant.
  const { open: queued, close: releaseTurn } = useMoment("level-advance", due);
  const showModal = queued || manual;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/student/advance", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const loaded: LevelAdvanceOffer | undefined = data.offer;
        if (cancelled || !loaded?.eligible) return;

        setOffer(loaded);

        // Once per level per device. Keyed on the level so the celebration
        // returns — earned again — when they finish the next one.
        if (!window.localStorage.getItem(`ew-advance-seen-${loaded.currentLevel}`)) {
          setDue(true);
        }
      } catch {
        // A dashboard must still render when this lookup fails. The office's
        // promotion report is the backstop for anyone this misses.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setManual(false);
    setDue(false);
    releaseTurn();
    // STAMPED ON CLOSE, NOT ON LOAD. It used to be written the moment the
    // offer arrived, which meant a celebration the queue held back for a
    // quieter moment was marked "seen" without ever having been on screen —
    // the student would simply never be told their level had ended.
    if (offer) {
      try {
        window.localStorage.setItem(`ew-advance-seen-${offer.currentLevel}`, new Date().toISOString());
      } catch {
        // Private browsing. One repeat beats a crash.
      }
    }
  }, [offer, releaseTurn]);

  if (!offer) return null;

  return (
    <div className={className}>
      <AdvanceCard offer={offer} onOpen={() => setManual(true)} />
      <AnimatePresence>
        {showModal ? <CelebrationModal offer={offer} onClose={dismiss} /> : null}
      </AnimatePresence>
    </div>
  );
}
