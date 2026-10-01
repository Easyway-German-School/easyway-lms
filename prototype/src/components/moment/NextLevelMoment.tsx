"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import type { JourneyPayload } from "@/lib/next-level-journey-server";

/**
 * Becca, to a student whose level just ended: "look what you did — and here is
 * what comes next."
 *
 * Until now a finished student simply went quiet and later asked the front desk
 * about A2. This speaks first, personally, with one real number from their own
 * month, and sends them to the full journey.
 *
 * Rules, learned from the moment-queue notes:
 *  - queue-managed (id "next-level"), so it never stacks on the tour or the goal
 *    question, and drops to the dock if the visit's two-modal cap is spent;
 *  - NOT behind `hasAccess` — a graduate on the locked countdown screen is the
 *    person this is for;
 *  - "seen" is stamped on CLOSE, never on load, or a pop the queue held back
 *    would count as shown;
 *  - it stops once they have kept a seat or paid, and otherwise comes back at
 *    most every 30 hours, six times in total. Persistence, not pestering.
 */

const GAP_MS = 30 * 60 * 60 * 1000;
const MAX_POPS = 6;
const key = (level: string) => `ew-next-level-pop-${level}`;

type PopState = { last: number; count: number };

function readPop(level: string): PopState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(level)) || "{}");
    return { last: Number(raw.last) || 0, count: Number(raw.count) || 0 };
  } catch {
    return { last: 0, count: 0 };
  }
}

export default function NextLevelMoment() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [journey, setJourney] = useState<JourneyPayload | null>(null);
  const [due, setDue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/next-level", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const j: JourneyPayload | null = data?.journey ?? null;
        if (!j) return;
        // Only students whose portal is open (paid at least the deposit). A locked
        // student is never popped at about the next level.
        if (!j.portalOpen) return;
        // Already acted — keeping a seat or paying ends the nudging.
        if (j.intent?.heldAt || j.offer.seat !== "none") return;
        const pop = readPop(j.audience.targetLevel);
        if (pop.count >= MAX_POPS || Date.now() - pop.last < GAP_MS) return;
        setJourney(j);
        setDue(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // On the journey page itself the pop would be talking over its own answer.
  const eligible = due && pathname !== "/next-level";
  const { open, close } = useMoment("next-level", eligible);

  const stamp = useCallback(() => {
    if (!journey) return;
    const level = journey.audience.targetLevel;
    const pop = readPop(level);
    try {
      window.localStorage.setItem(key(level), JSON.stringify({ last: Date.now(), count: pop.count + 1 }));
    } catch {
      // Private browsing: one repeat beats a crash.
    }
  }, [journey]);

  if (!open || !journey || typeof document === "undefined") return null;

  const { audience, recap, offer } = journey;
  const target = audience.targetLevel;
  const lead = recap.stats[0];
  const first = recap.headline.split(",")[0];

  const dismiss = () => {
    stamp();
    close();
  };
  const go = () => {
    stamp();
    close();
    window.location.assign("/next-level");
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/65 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Your ${target} plan`}>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 30, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        className="w-full max-w-sm overflow-hidden rounded-[30px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
      >
        <div className="relative bg-gradient-to-br from-[#0D7C7E] to-[#FF6600] px-6 pb-4 pt-6">
          <motion.div animate={reduce ? undefined : { y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
            <Mascot mood="celebrating" className="mx-auto h-24 w-24" />
          </motion.div>
          <div className="mt-2 flex items-center justify-center gap-3 text-white">
            <span className="rounded-xl bg-white/15 px-3 py-1 text-sm font-bold">{audience.finishedLevel}</span>
            <span aria-hidden>→</span>
            <span className="rounded-xl bg-white px-3 py-1 text-sm font-extrabold text-[#0D7C7E]">{target}</span>
          </div>
        </div>
        <div className="p-6">
          <h2 className="text-xl font-extrabold leading-tight text-[var(--foreground)]">
            {first ? `${first}, ` : ""}
            {audience.state === "midway" ? `you're a month into ${audience.finishedLevel}!` : `${audience.finishedLevel} is done!`}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {lead
              ? lead.key === "classes"
                ? `You made it to ${lead.value} ${lead.suffix ?? ""} classes. `
                : `${lead.value} ${lead.label.toLowerCase()} — that is real work. `
              : ""}
            I built your {target} plan from how <em>you</em> learn
            {offer.opensLabel ? ` — class opens ${offer.opensLabel}` : ""}. Want to see it and keep your seat?
          </p>
          <button onClick={go} className="mt-5 w-full rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white">
            Show me my {target} plan
          </button>
          <button onClick={dismiss} className="mt-2 w-full rounded-full px-6 py-2.5 text-sm font-semibold text-[var(--muted)]">
            Later
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
