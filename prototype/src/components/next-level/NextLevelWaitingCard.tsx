"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import type { JourneyPayload } from "@/lib/next-level-journey-server";

/**
 * On the locked countdown screen, for a graduate who was just moved up: the
 * first thing they see is their own achievement and a way to confirm the seat,
 * not a padlock. Renders nothing for anyone who is not in the audience (a
 * brand-new October sign-up has no finished level to recap).
 */
export default function NextLevelWaitingCard() {
  const reduce = useReducedMotion();
  const [journey, setJourney] = useState<JourneyPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/next-level", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setJourney(data?.journey ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!journey) return null;
  const { audience, offer, intent } = journey;
  const done = offer.seat !== "none";
  const held = Boolean(intent?.heldAt);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mt-6 w-full overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-[#0D7C7E]/90 to-[#FF6600]/90 p-5 text-left text-white shadow-xl"
    >
      {!reduce && (
        <motion.span
          aria-hidden
          animate={{ x: ["-130%", "130%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute inset-y-0 w-1/4 -skew-x-12 bg-white/20 blur-md"
        />
      )}
      <p className="relative text-[11px] font-bold uppercase tracking-[0.24em] text-white/80">
        {audience.finishedLevel} complete
      </p>
      <p className="relative mt-1 text-lg font-extrabold">
        {done
          ? `You are in for ${audience.targetLevel}.`
          : held
            ? `Your ${audience.targetLevel} seat is being kept.`
            : `See what you did in ${audience.finishedLevel} — and your ${audience.targetLevel} plan.`}
      </p>
      <Link
        href="/next-level"
        className="relative mt-3 inline-block rounded-full bg-white px-6 py-2.5 text-sm font-bold text-[#0D7C7E] transition hover:scale-[1.03]"
      >
        {done ? "See my plan" : held ? "Review my details" : `Plan my ${audience.targetLevel}`}
      </Link>
    </motion.div>
  );
}
