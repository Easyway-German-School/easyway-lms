"use client";
import { CheckIcon } from "@/components/icons";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { StudentAccess } from "@/lib/access";
import Mascot from "@/components/Mascot";
import GermanyJourney from "@/components/journey/GermanyJourney";
import { PRIVATE_CLASS_UPGRADE_PRICE } from "@/lib/payment";

/**
 * The one-to-one option, offered on the locked screen.
 *
 * Its own component so the checkout call and its failure state stay out of the
 * lock screen's animation tree — this panel can be mid-request while the
 * mascot is still walking in, and neither should re-render the other.
 */
function PrivateClassAlternative() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "private_class_upgrade" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not start that payment.");
        return;
      }
      if (data.authorizationUrl) window.location.href = data.authorizationUrl;
      else setError("Could not start that payment.");
    } catch {
      setError("Could not start that payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // This card sits on the screen's own hardcoded dark scrim, not on the
    // site's themed background, so its colours are fixed light-on-dark rather
    // than pulled from --surface/--border/--muted — those flip to near-white
    // in the light theme and made this whole panel unreadable.
    <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.04] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
        Or study one-to-one
      </p>
      <p className="mt-2 text-sm leading-6 text-white/70">
        Private tuition is a tutor to yourself, at times you choose, instead of a seat in
        the group class — {naira(PRIVATE_CLASS_UPGRADE_PRICE)} for your level.
      </p>
      <button
        onClick={start}
        disabled={busy}
        className="mt-3 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Study one-to-one instead"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

/** Fixed, not random — random positions would differ between server and client. */
const EMBERS = [
  { left: "8%", top: "22%", delay: 0, size: 6 },
  { left: "17%", top: "68%", delay: 1.4, size: 4 },
  { left: "31%", top: "12%", delay: 2.1, size: 5 },
  { left: "44%", top: "82%", delay: 0.7, size: 3 },
  { left: "58%", top: "18%", delay: 2.8, size: 5 },
  { left: "72%", top: "72%", delay: 1.1, size: 4 },
  { left: "84%", top: "32%", delay: 3.2, size: 6 },
  { left: "92%", top: "58%", delay: 1.9, size: 3 },
];

function naira(value: number) {
  return `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
}

/**
 * A blurred impression of the page that would have been here.
 *
 * Deliberately a skeleton rather than the real page behind a blur filter: a CSS
 * blur is only paint, so the actual timetable, grades and material links would
 * still be sitting in the DOM for anyone who opens devtools. A paywall that
 * ships the content it is withholding is not a paywall.
 */
function BlurredPageGhost() {
  return (
    <div aria-hidden className="absolute inset-0 select-none opacity-90 blur-[11px] saturate-[0.6]">
      <div className="space-y-6 p-10">
        <div className="h-9 w-2/5 rounded-full bg-slate-400/50" />
        <div className="h-4 w-3/5 rounded-full bg-slate-300/45" />
        <div className="grid grid-cols-2 gap-5 pt-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-[var(--surface-alt)]/50" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="space-y-4 rounded-3xl bg-[var(--surface-alt)]/50 p-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-11 w-11 rounded-2xl bg-slate-400/40" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 rounded-full bg-slate-400/40" style={{ width: `${88 - i * 9}%` }} />
                  <div className="h-3 rounded-full bg-slate-300/40" style={{ width: `${64 - i * 7}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4 rounded-3xl bg-[var(--surface-alt)]/50 p-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-slate-300/40" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentLockScreen({
  areaLabel,
  access,
}: {
  /** Which part of the portal is locked, e.g. "Classes" — names the padlock. */
  areaLabel: string;
  access: StudentAccess | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const reduceMotion = useReducedMotion();

  // Two locks share this screen. The default is a registration-only student who
  // never cleared the 60% deposit. `unsettled_balance` is a student who DID
  // start class on a part-payment and then let the 30-day balance grace run
  // out — a different message, different figures (against the full fee, not the
  // deposit) and no "study one-to-one instead" offer, since they are already
  // enrolled.
  const balanceLock = access?.lockReason === "unsettled_balance";
  const outstanding = balanceLock ? access?.outstandingBalance ?? 0 : access?.outstanding ?? 0;
  const progress = balanceLock ? access?.feeProgressPercent ?? 0 : access?.progressPercent ?? 0;
  const registrationPaid = access?.registrationPaid ?? true;
  const lockedSince = balanceLock && access?.lockAt ? new Date(access.lockAt) : null;

  return (
    <>
    <div className="relative min-h-[calc(100vh-1px)] overflow-hidden">
      <BlurredPageGhost />

      {/* Scrim: darkens and cools the ghost so the padlock owns the frame, but
          stays translucent enough that the blurred page still reads as a page. */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,_rgba(13,124,126,0.45),_transparent_55%),linear-gradient(160deg,_rgba(2,6,23,0.78)_0%,_rgba(6,25,32,0.85)_45%,_rgba(2,6,23,0.9)_100%)]" />

      {!reduceMotion &&
        EMBERS.map((ember, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-[#FF6600]/70 blur-[1px]"
            style={{ left: ember.left, top: ember.top, height: ember.size, width: ember.size }}
            animate={{ y: [0, -26, 0], opacity: [0.15, 0.75, 0.15] }}
            transition={{ duration: 7 + i, repeat: Infinity, delay: ember.delay, ease: "easeInOut" }}
          />
        ))}

      <div className="relative z-10 flex min-h-[calc(100vh-1px)] flex-col items-center justify-center px-6 py-14 text-center">
        <motion.p
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[11px] font-semibold uppercase tracking-[0.42em] text-[#FF9d5c]"
        >
          {areaLabel} locked
        </motion.p>

        {/* ---- The padlock ---- */}
        <motion.button
          type="button"
          onClick={() => setRevealed(true)}
          aria-label={`${areaLabel} is locked. Reveal why.`}
          className="group relative mt-8 rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-[#FF6600]/60"
          animate={{ scale: revealed ? 0.62 : 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 18 }}
          whileHover={{ scale: revealed ? 0.66 : 1.04 }}
          whileTap={{ scale: revealed ? 0.6 : 0.96 }}
        >
          {/* Shockwave rings, fired on the click that reveals the message */}
          <AnimatePresence>
            {revealed && !reduceMotion && (
              <>
                {[0, 1].map((ring) => (
                  <motion.span
                    key={ring}
                    className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#FF6600]/60"
                    initial={{ scale: 0.8, opacity: 0.85 }}
                    animate={{ scale: 2.1, opacity: 0 }}
                    transition={{ duration: 1.1, delay: ring * 0.18, ease: "easeOut" }}
                  />
                ))}
              </>
            )}
          </AnimatePresence>

          {/* Breathing halo */}
          <motion.span
            className="pointer-events-none absolute -inset-8 rounded-full bg-[#FF6600]/25 blur-3xl"
            animate={reduceMotion ? {} : { opacity: [0.35, 0.8, 0.35], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />

          <svg
            viewBox="0 0 200 240"
            className="relative h-[clamp(190px,32vmin,290px)] w-[clamp(190px,32vmin,290px)] drop-shadow-[0_30px_60px_rgba(255,102,0,0.28)]"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="lock-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffab5e" />
                <stop offset="52%" stopColor="#FF6600" />
                <stop offset="100%" stopColor="#d94f00" />
              </linearGradient>
              <linearGradient id="lock-shackle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>

            {/* Shackle — jolts once when clicked, as if tested and refused */}
            <motion.path
              d="M62 104V74a38 38 0 0 1 76 0v30"
              fill="none"
              stroke="url(#lock-shackle)"
              strokeWidth="21"
              strokeLinecap="round"
              animate={revealed && !reduceMotion ? { y: [0, -9, 0, -4, 0], rotate: [0, -2, 2, 0] } : { y: 0 }}
              transition={{ duration: 0.55, ease: "easeInOut" }}
              style={{ originX: "100px", originY: "104px" }}
            />

            <rect x="34" y="102" width="132" height="116" rx="26" fill="url(#lock-body)" />
            {/* Bevel highlight along the top-left of the case */}
            <path
              d="M52 118a14 14 0 0 1 14-14h70"
              stroke="#ffffff"
              strokeOpacity="0.4"
              strokeWidth="7"
              strokeLinecap="round"
              fill="none"
            />

            {/* Keyhole */}
            <circle cx="100" cy="150" r="17" fill="#7c2d12" />
            <path d="M100 162l-8 34h16z" fill="#7c2d12" />
            <motion.circle
              cx="94"
              cy="144"
              r="5"
              fill="#ffffff"
              animate={reduceMotion ? { opacity: 0.4 } : { opacity: [0.25, 0.7, 0.25] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            />
          </svg>

          {!revealed && (
            <motion.span
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-white backdrop-blur"
              animate={reduceMotion ? {} : { y: [0, -5, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              Tap the lock
            </motion.span>
          )}
        </motion.button>

        {/* ---- Mascot + message, revealed on the tap ---- */}
        <AnimatePresence>
          {revealed && (
            <motion.div
              key="reveal"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 18 }}
              transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.15 }}
              className="mt-2 flex w-full max-w-4xl flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-0"
            >
              {/* The mascot walks in from the left, then points right at the copy */}
              <motion.div
                initial={{ x: -70, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 80, damping: 15, delay: 0.25 }}
                className="shrink-0"
              >
                {/* `concerned`, not cheerful and certainly not stern. This is the
                    screen where somebody has hit a wall over money; a beaming
                    mascot reads as gloating and a frowning one as blame. An
                    awkward, attentive face is the only honest option. */}
                <Mascot mood="concerned" className="h-44 w-44 sm:h-56 sm:w-56" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.94, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{ delay: 0.55, type: "spring", stiffness: 120, damping: 16 }}
                className="relative flex-1 rounded-[28px] border border-white/15 bg-white/[0.07] p-7 text-left shadow-[0_30px_80px_rgba(2,6,23,0.5)] backdrop-blur-xl"
              >
                {/* Speech-bubble notch aimed back at the pointing hand */}
                <span className="absolute -left-2 top-1/2 hidden h-5 w-5 -translate-y-1/2 rotate-45 border-b border-l border-white/15 bg-white/[0.07] sm:block" />

                <p className="text-2xl font-semibold leading-snug text-white sm:text-[26px]">
                  {balanceLock
                    ? "Please settle your tuition balance to keep going."
                    : "Please proceed to pay the tuition fee to start your classes."}
                </p>

                <div className="mt-6 space-y-3">
                  {balanceLock ? (
                    <>
                      <div className="flex items-center gap-3 text-sm text-emerald-200">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20">
                          <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                        </span>
                        Deposit paid — you have been in class
                      </div>
                      <div className="flex items-center gap-3 text-sm text-amber-100">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-xs">
                          !
                        </span>
                        {outstanding > 0
                          ? `${naira(outstanding)} balance outstanding${
                              lockedSince
                                ? ` since ${lockedSince.toLocaleDateString("en-NG", { day: "numeric", month: "long" })}`
                                : ""
                            }`
                          : "Tuition balance outstanding"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 text-sm text-emerald-200">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20">
                          <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                        </span>
                        Registration fee received
                      </div>
                      <div className="flex items-center gap-3 text-sm text-amber-100">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-xs">
                          !
                        </span>
                        {registrationPaid && outstanding > 0
                          ? `${naira(outstanding)} left to unlock your class`
                          : "Tuition fee outstanding"}
                      </div>
                    </>
                  )}
                </div>

                {balanceLock && access && access.tuitionFee > 0 ? (
                  <div className="mt-6">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                      <span>Tuition paid</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-[#FF6600] to-[#0D7C7E]"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(progress, 3)}%` }}
                        transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-white/60">
                      {naira(access.totalPaid)} of {naira(access.tuitionFee)} paid
                    </p>
                  </div>
                ) : null}

                {!balanceLock && access && access.requiredDeposit > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                      <span>Towards your seat</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-[#FF6600] to-[#0D7C7E]"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(progress, 3)}%` }}
                        transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-white/60">
                      {naira(access.totalPaid)} of {naira(access.requiredDeposit)} paid
                    </p>
                  </div>
                )}

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    href="/programs"
                    className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/30 transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    {balanceLock ? "Pay my balance" : "Pay tuition now"}
                  </Link>
                  <Link
                    href="/payments"
                    className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    View my payments
                  </Link>
                </div>

                {/*
                  THE OTHER DOOR — registration-only students only.

                  One-to-one tuition is an ALTERNATIVE to the group fee, not an
                  extra on top of it, and the deposit screen is the one moment a
                  student is actively deciding how to pay for the course. A
                  student locked out over an unpaid BALANCE is already enrolled
                  on a track, so switching them to private here makes no sense —
                  they just need to settle what they owe.
                */}
                {!balanceLock && <PrivateClassAlternative />}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!revealed && (
          <p className="mt-10 max-w-md text-sm leading-7 text-white/60">
            {balanceLock
              ? `Your tuition balance is outstanding — settle it to unlock ${areaLabel.toLowerCase()} again.`
              : `Your registration is confirmed — pay the tuition fee to unlock ${areaLabel.toLowerCase()}.`}
          </p>
        )}

      </div>
    </div>

    {/*
      The road, under the padlock.

      This is the one page a registration-only student ever sees, and until now
      it was a locked door with a price on it. Their whole journey map — every
      level, the exam, the visa, the landing, with their own name on it — is the
      most persuasive thing the school owns, and showing it to somebody who has
      not paid costs nothing: the map is a picture of a plan, not a delivered
      service. Nothing behind the paywall leaks, because there is nothing behind
      the paywall in it.

      It sits OUTSIDE the locked hero rather than inside it. That block is
      `overflow-hidden` with a viewport-height scrim, so anything added within
      it is clipped and unreachable — which is exactly what happened on the
      first attempt. The padlock keeps its full screen; the road begins where
      it ends.

      GermanyJourney renders itself in preview mode here, so it carries the
      "yours the moment your seat is paid" panel and its own checkout link
      rather than pretending the road has started.
    */}
    <section className="border-t border-[var(--border)] bg-[var(--background)] px-4 py-12 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--muted)]">
          While you are here — this is where it goes
        </p>
        {/* Inline, not behind a button: on this screen the map IS the pitch. */}
        <GermanyJourney variant="inline" />
      </div>
    </section>
    </>
  );
}
