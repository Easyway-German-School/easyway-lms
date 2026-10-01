"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import Mascot from "@/components/Mascot";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";
import { ADVANCE_PERKS, naira } from "@/lib/level-advance";
import { safeJson } from "@/lib/safe-json";
import type { JourneyPayload } from "@/lib/next-level-journey-server";

/**
 * Becca walks a finished student from "I completed a level" to "my seat in the
 * next one is kept" — in four short, tactile steps instead of a form.
 *
 *   0  Celebrate   confetti, the badge flips A1 → A2
 *   1  Your numbers   counted up, every one of them real
 *   2  Perks + plan   scratch-to-reveal (true perks only) and a plan that names
 *                     the number each card was written from
 *   3  Your seat   details, the real opening day, the real price, then pay
 *
 * The animation is the reward, not a trick: nothing here is a fake discount, a
 * fake countdown or a fake "3 seats left". See lib/next-level-journey.ts.
 */

const BRAND = "from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600]";

/* ------------------------------ small pieces ------------------------------ */

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) {
      setN(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return (
    <>
      {n}
      {suffix ? <span className="ml-1 text-base font-semibold opacity-80">{suffix}</span> : null}
    </>
  );
}

const CONFETTI_COLOURS = ["#FF6600", "#0D7C7E", "#FFC857", "#ffffff", "#7BDFF2", "#F7567C"];

/** Deterministic per index, so a re-render never reshuffles a burst mid-air. */
function Confetti({ burst }: { burst: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => {
        const a = (i * 137.5 * Math.PI) / 180;
        const r = 90 + ((i * 53) % 190);
        return {
          dx: Math.cos(a) * r,
          dy: Math.sin(a) * r * 0.7 - 60,
          fall: 140 + ((i * 29) % 160),
          rot: ((i * 71) % 720) - 360,
          size: 6 + ((i * 7) % 7),
          colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
          round: i % 3 === 0,
          dur: 1.5 + ((i * 13) % 12) / 10,
        };
      }),
    [],
  );
  if (reduce || burst === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 z-30 flex justify-center">
      {pieces.map((p, i) => (
        <motion.span
          key={`${burst}-${i}`}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: p.dx, y: [0, p.dy, p.dy + p.fall], opacity: [1, 1, 0], rotate: p.rot, scale: 1 }}
          transition={{ duration: p.dur, ease: "easeOut", times: [0, 0.45, 1] }}
          style={{ width: p.size, height: p.size, background: p.colour, borderRadius: p.round ? 999 : 2 }}
          className="absolute"
        />
      ))}
    </div>
  );
}

function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex justify-center gap-2" aria-label={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          key={i}
          animate={{ width: i === step ? 28 : 8, opacity: i <= step ? 1 : 0.35 }}
          className="h-2 rounded-full bg-[var(--accent)]"
        />
      ))}
    </div>
  );
}

function buzz() {
  try {
    navigator.vibrate?.(14);
  } catch {
    // Not every phone, not every browser. The sparkle is enough.
  }
}

/** One scratch-to-reveal card. Front is a shimmer; back is a real perk. */
function PerkCard({ label, detail, revealed, onReveal, index }: { label: string; detail: string; revealed: boolean; onReveal: () => void; index: number }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!revealed) {
          buzz();
          onReveal();
        }
      }}
      aria-label={revealed ? label : "Reveal a perk"}
      className="relative h-40 [perspective:900px] text-left"
    >
      <motion.div
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 160, damping: 18 }}
        style={{ transformStyle: "preserve-3d" }}
        className="absolute inset-0"
      >
        <div
          style={{ backfaceVisibility: "hidden" }}
          className={`absolute inset-0 grid place-items-center overflow-hidden rounded-3xl bg-gradient-to-br ${BRAND} shadow-lg`}
        >
          <motion.div
            aria-hidden
            animate={{ x: ["-120%", "120%"] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
            className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/25 blur-md"
          />
          <div className="relative text-center text-white">
            <p className="text-4xl font-black">?</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.24em]">Tap to reveal</p>
          </div>
        </div>
        <div
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          className="absolute inset-0 flex flex-col justify-center rounded-3xl border border-emerald-400/40 bg-[var(--surface)] p-4 shadow-lg"
        >
          <span className="mb-2 grid h-6 w-6 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
            <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <p className="text-sm font-bold leading-snug text-[var(--foreground)]">{label}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
        </div>
      </motion.div>
    </button>
  );
}

/* --------------------------------- screens -------------------------------- */

const SLOTS = [
  ["morning", "Morning"],
  ["afternoon", "Afternoon"],
  ["evening", "Evening"],
  ["weekend", "Weekend"],
] as const;
const MODES = [
  ["physical", "On campus"],
  ["online", "Online"],
  ["hybrid", "Hybrid"],
] as const;

function Pills<T extends string>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: string; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
            value === key
              ? "border-transparent bg-[var(--accent)] text-white shadow"
              : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function NextLevelJourney() {
  const reduce = useReducedMotion();
  const [journey, setJourney] = useState<JourneyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [burst, setBurst] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({ phone: "", parentPhone: "", sessionSlot: "morning", deliveryMode: "physical", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [held, setHeld] = useState(false);
  const seenSent = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/next-level", { cache: "no-store" });
        const json = await safeJson(res);
        if (cancelled) return;
        const j: JourneyPayload | null = json?.journey ?? null;
        setJourney(j);
        if (j) {
          setForm((f) => ({ ...f, ...j.prefill, note: j.intent?.details?.note ?? "" }));
          setHeld(Boolean(j.intent?.heldAt));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The first screen is the celebration — fire the confetti and note, once, that they opened it.
  useEffect(() => {
    if (!journey || seenSent.current) return;
    seenSent.current = true;
    const t = window.setTimeout(() => setBurst((b) => b + 1), 450);
    if (!journey.intent?.seenAt) {
      fetch("/api/student/next-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seen" }),
      }).catch(() => undefined);
    }
    return () => window.clearTimeout(t);
  }, [journey]);

  const go = useCallback((n: number) => setStep(n), []);

  async function keepSeat() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/student/next-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hold", details: form }),
      });
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error || "Could not save that");
      setHeld(true);
      setBurst((b) => b + 1);
      buzz();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-xl p-10 text-center text-[var(--muted)]">Getting your journey ready…</div>;
  }

  if (!journey) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <h1 className="text-xl font-bold text-[var(--foreground)]">Nothing to plan just yet</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your next-level plan appears here the moment your current level wraps up.
          </p>
          <Link href="/dashboard" className="mt-5 inline-block rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Back to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { audience, recap, offer } = journey;
  const target = audience.targetLevel;
  const perks = ADVANCE_PERKS;
  const allRevealed = revealed.size >= perks.length;
  const inSeat = offer.seat !== "none";
  const total = 4;

  const slide = {
    initial: reduce ? false : { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? undefined : { opacity: 0, x: -40 },
    transition: { duration: 0.35 },
  } as const;

  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <Confetti burst={burst} />
      <div className="mb-5">
        <Dots step={step} total={total} />
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.section key="s0" {...slide} className="overflow-hidden rounded-[32px] shadow-2xl">
            <div className={`relative bg-gradient-to-br ${BRAND} px-7 pb-8 pt-8 text-center text-white`}>
              {[0, 1, 2].map((ring) => (
                <motion.div
                  key={ring}
                  aria-hidden
                  initial={{ scale: 0.4, opacity: 0.5 }}
                  animate={{ scale: 2.6, opacity: 0 }}
                  transition={{ duration: 2.6, delay: ring * 0.8, repeat: Infinity, ease: "easeOut" }}
                  className="pointer-events-none absolute left-1/2 top-24 h-40 w-40 -translate-x-1/2 rounded-full border border-white/25"
                />
              ))}
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">
                {audience.state === "midway" ? `A month into ${audience.finishedLevel}` : "Level complete"}
              </p>

              <div className="relative mx-auto mt-3 h-40 w-40">
                <Mascot mood="celebrating" className="h-full w-full" />
              </div>

              <div className="mt-2 flex items-center justify-center gap-4 [perspective:700px]">
                <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/25 bg-white/15 text-xl font-bold backdrop-blur">
                  {audience.finishedLevel}
                </div>
                <ArrowRightIcon className="h-6 w-6 text-white/70" />
                <motion.div
                  initial={reduce ? false : { rotateY: 180, scale: 0.6, opacity: 0 }}
                  animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5, type: "spring", stiffness: 140, damping: 14 }}
                  className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-xl font-bold text-[#0D7C7E] shadow-xl"
                >
                  {target}
                </motion.div>
              </div>

              <h1 className="mt-5 text-2xl font-extrabold leading-tight sm:text-3xl">{recap.headline}</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/85">
                I put together what you achieved and a {target} plan built around how <em>you</em> learn.{" "}
                {audience.state === "midway" ? "Two minutes, and the office can keep your place early." : "Two minutes, and your seat can be kept."}
              </p>
              <button
                onClick={() => go(1)}
                className="mt-6 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-[#0D7C7E] shadow-lg transition hover:scale-[1.03]"
              >
                Show me
              </button>
            </div>
          </motion.section>
        )}

        {step === 1 && (
          <motion.section key="s1" {...slide} className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">Your {audience.finishedLevel} in numbers</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">
              {recap.thin ? "Every level starts with showing up." : audience.state === "midway" ? "This is what you have built so far." : "This is what you built."}
            </h2>

            {recap.stats.length > 0 ? (
              <div className="mt-5 grid grid-cols-2 gap-3">
                {recap.stats.map((s, i) => (
                  <motion.div
                    key={s.key}
                    initial={reduce ? false : { opacity: 0, y: 18, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.15 + i * 0.14, type: "spring", stiffness: 220, damping: 20 }}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4"
                  >
                    <p className="text-3xl font-black text-[var(--foreground)]">
                      <CountUp to={s.value} />
                      {s.suffix ? <span className="ml-1 text-sm font-semibold text-[var(--muted)]">{s.suffix}</span> : null}
                    </p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{s.label}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{s.note}</p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                You finished {audience.finishedLevel}. The next level is where the habit really pays off — and I will track every step for you.
              </p>
            )}

            {(recap.strength || recap.rhythmLine) && (
              <motion.div
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="mt-4 space-y-2 rounded-2xl bg-[var(--accent-soft)] p-4 text-sm text-[var(--foreground)]"
              >
                {recap.strength && (
                  <p>
                    Your strongest skill: <strong>{recap.strength.skill}</strong> ({recap.strength.score}%).
                  </p>
                )}
                {recap.rhythmLine && <p>{recap.rhythmLine}</p>}
              </motion.div>
            )}

            <div className="mt-6 flex gap-3">
              <button onClick={() => go(0)} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--muted)]">
                Back
              </button>
              <button onClick={() => go(2)} className="flex-1 rounded-full btn-glow px-6 py-3 text-sm font-bold text-white">
                What is {target} like for me?
              </button>
            </div>
          </motion.section>
        )}

        {step === 2 && (
          <motion.section key="s2" {...slide} className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">Your {target} plan</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">Built from your own habits</h2>
            <div className="mt-4 space-y-3">
              {recap.plan.map((p, i) => (
                <motion.div
                  key={p.key}
                  initial={reduce ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.12 }}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4"
                >
                  <p className="text-sm font-bold text-[var(--foreground)]">{p.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{p.detail}</p>
                  <p className="mt-2 inline-block rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Because: {p.because}
                  </p>
                </motion.div>
              ))}
            </div>

            <div className="mt-7 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">Perks of continuing</p>
                <h3 className="mt-1 text-lg font-bold text-[var(--foreground)]">Tap each card to reveal</h3>
              </div>
              <p className="text-sm font-semibold text-[var(--muted)]">
                {revealed.size}/{perks.length}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {perks.map((perk, i) => (
                <PerkCard
                  key={perk.label}
                  index={i}
                  label={perk.label}
                  detail={perk.detail}
                  revealed={revealed.has(i)}
                  onReveal={() => {
                    setRevealed((prev) => new Set(prev).add(i));
                    if (revealed.size + 1 >= perks.length) setBurst((b) => b + 1);
                  }}
                />
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-[var(--muted)]">
              These are how the school already works — no coupon, no countdown, nothing invented.
            </p>

            <div className="mt-6 flex gap-3">
              <button onClick={() => go(1)} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--muted)]">
                Back
              </button>
              <motion.button
                onClick={() => go(3)}
                animate={allRevealed && !reduce ? { scale: [1, 1.04, 1] } : undefined}
                transition={{ repeat: Infinity, duration: 1.6 }}
                className="flex-1 rounded-full btn-glow px-6 py-3 text-sm font-bold text-white"
              >
                {allRevealed ? `Keep my ${target} seat` : `Continue to my ${target} seat`}
              </motion.button>
            </div>
          </motion.section>
        )}

        {step === 3 && (
          <motion.section key="s3" {...slide} className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            {inSeat ? (
              <div className="py-6 text-center">
                <div className="mx-auto h-28 w-28">
                  <Mascot mood="celebrating" className="h-full w-full" />
                </div>
                <h2 className="mt-3 text-2xl font-extrabold text-[var(--foreground)]">You are in for {target}!</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {offer.seat === "full" ? "Paid in full." : "Your deposit is paid and your seat is secured."}
                  {offer.opensLabel ? ` Class opens ${offer.opensLabel}.` : ""}
                </p>
                <Link href="/dashboard" className="mt-5 inline-block rounded-full btn-glow px-8 py-3 text-sm font-bold text-white">
                  Go to my dashboard
                </Link>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">Your {target} seat</p>
                <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">
                  {held ? "Your seat is being kept" : "Confirm your details"}
                </h2>
                {offer.opensLabel && (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {target} opens <strong className="text-[var(--foreground)]">{offer.opensLabel}</strong>.
                  </p>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{target} tuition</p>
                    <p className="mt-1 text-xl font-bold text-[var(--foreground)]">{naira(offer.tuitionFee)}</p>
                    <p className="text-xs text-[var(--muted)]">{offer.branchName ? `at ${offer.branchName}` : ""}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">To start class</p>
                    <p className="mt-1 text-xl font-bold text-[var(--foreground)]">{naira(offer.requiredDeposit)}</p>
                    <p className="text-xs text-[var(--muted)]">the deposit, not the full fee</p>
                  </div>
                </div>

                {offer.priorOwed > 0 && (
                  <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">{naira(offer.priorOwed)} is still open on {audience.finishedLevel}.</p>
                    <p className="mt-1">It is added to what you pay below, so your {target} seat is confirmed in one payment. We are telling you now, not at the counter.</p>
                  </div>
                )}

                <div className="mt-5 space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your phone (WhatsApp)</span>
                    <input
                      inputMode="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+234…"
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Parent / guardian phone (optional)</span>
                    <input
                      inputMode="tel"
                      value={form.parentPhone}
                      onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
                      placeholder="+234…"
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                    />
                  </label>
                  <div>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Which sitting suits you?</span>
                    <Pills options={SLOTS} value={form.sessionSlot} onChange={(v) => setForm({ ...form, sessionSlot: v })} />
                  </div>
                  <div>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">How will you attend?</span>
                    <Pills options={MODES} value={form.deliveryMode} onChange={(v) => setForm({ ...form, deliveryMode: v })} />
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Anything we should know? (optional)</span>
                    <textarea
                      rows={2}
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)]"
                    />
                  </label>
                </div>

                {error && <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

                <div className="mt-5 space-y-3">
                  <button
                    onClick={keepSeat}
                    disabled={saving}
                    className="w-full rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {saving ? "Saving…" : held ? "Update my details" : `Keep my ${target} seat`}
                  </button>

                  <AnimatePresence>
                    {held && (
                      <motion.div
                        initial={reduce ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-[var(--foreground)]"
                      >
                        <p className="font-semibold">Saved. The office has been told and your details are updated.</p>
                        {offer.payHref && offer.sellableOnline ? (
                          <>
                            <p className="mt-1 text-[var(--muted)]">Pay the deposit to confirm your place in class — or settle in full whenever you like.</p>
                            <Link
                              href={offer.payHref}
                              className="mt-3 block rounded-full bg-[var(--accent)] px-6 py-3 text-center text-sm font-bold text-white"
                            >
                              Pay now to confirm {target}
                            </Link>
                          </>
                        ) : (
                          <p className="mt-1 text-[var(--muted)]">
                            {offer.sellableOnline
                              ? audience.state === "midway"
                                ? `Nothing to pay yet. Payment for ${target} opens when you finish ${audience.finishedLevel} — we will message you, and your place stays held.`
                                : "Your results are being finalised. The moment payment opens, we will message you — your seat stays held."
                              : `${target} is quoted by your branch office. They will reach you to confirm.`}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button onClick={() => go(2)} className="mt-4 text-sm font-semibold text-[var(--muted)] underline">
                  Back
                </button>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
