"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Mascot, { type MascotMood } from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import {
  ArrowRightIcon,
  AssignmentIcon,
  AttendanceIcon,
  BookOpenIcon,
  CheckCircleIcon,
  EssayIcon,
  FlameIcon,
  GameControllerIcon,
  MicIcon,
  SparklesIcon,
  StarIcon,
  TargetIcon,
} from "@/components/icons";

/**
 * BECCA'S DAILY HELLO.
 *
 * The gap this fills: the portal generated a fresh set of daily missions and a
 * daily brief every morning (see daily-missions-server.ts, student-brief.ts)
 * and then did nothing to put them in front of anyone. A student had to think
 * to scroll the dashboard to a card to discover the day had a shape. Nobody
 * does that on day three.
 *
 * So once a day, on the first page they land on, Becca herself brings it:
 * yesterday's streak still burning, how close the next level is, and the three
 * things worth doing today — each already showing whether the server has seen
 * it happen. It is the same data the dashboard shows quietly; this is the
 * version that says good morning.
 *
 * It is identical for on-campus, online and private students — the missions
 * engine already tailors itself per cohort, and "your streak, your XP, your
 * three things" is the same promise whichever room the class happens in.
 *
 * Queue-managed at priority 52 (see moment-queue.tsx): it never fights the
 * welcome tour or a level-complete celebration, and on a busy morning it waits
 * in the dock rather than stacking. Once-per-day is a localStorage day-key,
 * stamped on close so a briefing the queue held back is not marked seen.
 */

type Mission = {
  id: string;
  title: string;
  description: string;
  reward: string;
  detectType: string;
  done: boolean;
};

type Gamification = {
  level: number;
  levelProgressPercent: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  streak: number;
  tier?: { label?: string } | null;
} | null;

type PaymentNote = {
  outstanding: number;
  lockDate: string;
  daysToLock: number;
  urgent: boolean;
  locked: boolean;
  graceUntil: string | null;
} | null;

type Brief = {
  headline: string;
  lines: string[];
  personalNote: string | null;
  paymentNote?: PaymentNote;
} | null;

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

/** Local calendar day — the briefing is a once-a-day thing, not a to-the-second one. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

const STORAGE_KEY = "ew-daily-briefing-day";

/** Where "let's go" sends them, by what the mission is waiting on. */
const AREA: Record<string, string> = {
  lesson: "/lesson",
  assignment: "/assignment",
  quiz: "/games",
  attendance: "/calendar",
  voice: "/tandem",
  essay: "/essay",
  story: "/play",
};

const MISSION_ICON: Record<string, (p: { className?: string }) => React.ReactElement> = {
  lesson: BookOpenIcon,
  assignment: AssignmentIcon,
  quiz: GameControllerIcon,
  attendance: AttendanceIcon,
  voice: MicIcon,
  essay: EssayIcon,
  story: SparklesIcon,
};

function missionIcon(type: string) {
  const Glyph = MISSION_ICON[type] ?? TargetIcon;
  return <Glyph className="h-4 w-4" />;
}

export default function DailyBriefing() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [game, setGame] = useState<Gamification>(null);
  const [brief, setBrief] = useState<Brief>(null);
  const [loaded, setLoaded] = useState(false);
  const [due, setDue] = useState(false);

  useEffect(() => {
    let alive = true;

    // Cheap early-out: if today's briefing is already stamped, don't even ask.
    let alreadySeen = false;
    try {
      alreadySeen = window.localStorage.getItem(STORAGE_KEY) === todayKey();
    } catch {
      /* private mode — fall through and let it show */
    }
    if (alreadySeen) {
      setLoaded(true);
      return;
    }

    (async () => {
      try {
        const [mRes, gRes, bRes] = await Promise.all([
          fetch("/api/student/missions", { cache: "no-store" }),
          fetch("/api/student/gamification", { cache: "no-store" }),
          fetch("/api/student/brief?period=daily", { cache: "no-store" }),
        ]);

        const m: Mission[] = mRes.ok ? (await mRes.json()).missions ?? [] : [];
        const g: Gamification = gRes.ok ? await gRes.json() : null;
        const b: Brief = bRes.ok ? await bRes.json() : null;

        if (!alive) return;
        setMissions(m);
        setGame(g);
        setBrief(b);
        // Nothing to say if the student is not a real student (no gamification
        // row) and has no missions — better to stay silent than greet an empty
        // shell. A tuition balance to chase is always worth showing.
        setDue(m.length > 0 || Boolean(g) || Boolean(b?.paymentNote));
      } catch {
        /* Offline. The dashboard cards are the backstop. */
      } finally {
        if (alive) setLoaded(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const { open, close } = useMoment("daily-briefing", loaded && due);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, todayKey());
    } catch {
      /* One repeat beats a crash. */
    }
    setDue(false);
    close();
  }, [close]);

  const doneCount = missions.filter((mi) => mi.done).length;
  const allDone = missions.length > 0 && doneCount === missions.length;
  const firstUndone = missions.find((mi) => !mi.done);

  const streak = game?.streak ?? 0;

  const mood: MascotMood = allDone
    ? "celebrating"
    : streak >= 5
      ? "cocky"
      : streak >= 1
        ? "cheerful"
        : "greeting";

  const beccaLine = useMemo(() => {
    if (brief?.personalNote) return brief.personalNote;
    if (allDone) return "Every mission already done — look at you. Rest easy today.";
    if (streak >= 5) return `${streak} days straight. This is just who you are now.`;
    if (streak >= 1) return `Day ${streak} of your streak. Let's keep it lit.`;
    if (brief?.headline) return brief.headline;
    return "New day, fresh missions. Pick one and we're moving.";
  }, [brief, allDone, streak]);

  const go = useCallback(() => {
    const dest = firstUndone ? AREA[firstUndone.detectType] ?? "/dashboard" : "/dashboard";
    dismiss();
    router.push(dest);
  }, [firstUndone, dismiss, router]);

  if (!loaded || !due) return null;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Your day with Becca"
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="relative my-auto w-full max-w-lg overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-2xl"
          >
            {/* Hero band — Becca, the greeting, and the streak flame. */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-7 pb-7 pt-8 text-white">
              {!reduceMotion &&
                [0, 1, 2].map((ring) => (
                  <motion.div
                    key={ring}
                    aria-hidden
                    initial={{ scale: 0.4, opacity: 0.4 }}
                    animate={{ scale: 2.4, opacity: 0 }}
                    transition={{ duration: 2.6, delay: ring * 0.8, repeat: Infinity, ease: "easeOut" }}
                    className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full border border-white/40"
                  />
                ))}

              <div className="relative flex items-start gap-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 240, damping: 18 }}
                >
                  <Mascot mood={mood} className="h-24 w-24 shrink-0 drop-shadow-xl" />
                </motion.div>

                <div className="min-w-0 flex-1 pt-1">
                  <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/75"
                  >
                    Good to see you
                  </motion.p>
                  <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="mt-2 text-lg font-bold leading-snug"
                  >
                    &ldquo;{beccaLine}&rdquo;
                  </motion.p>
                </div>
              </div>

              {/* Streak + level, the two numbers that pull people back. */}
              <div className="relative mt-6 grid grid-cols-2 gap-3">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="rounded-2xl bg-white/15 p-3 backdrop-blur"
                >
                  <div className="flex items-center gap-2">
                    <motion.span
                      animate={reduceMotion || streak === 0 ? {} : { scale: [1, 1.18, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                    >
                      <FlameIcon className="h-5 w-5 text-amber-300" />
                    </motion.span>
                    <span className="text-2xl font-black tabular-nums">{streak}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-white/70">
                    day streak
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.48 }}
                  className="rounded-2xl bg-white/15 p-3 backdrop-blur"
                >
                  <div className="flex items-center gap-2">
                    <StarIcon className="h-5 w-5 text-amber-300" />
                    <span className="text-2xl font-black tabular-nums">{game?.level ?? 1}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-white/70">
                    {game?.tier?.label ?? "level"}
                  </p>
                  {game ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${game.levelProgressPercent}%` }}
                        transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                        className="h-full rounded-full bg-amber-300"
                      />
                    </div>
                  ) : null}
                </motion.div>
              </div>
            </div>

            {/* Tuition balance — a part-payer sees this every day until it clears. */}
            {brief?.paymentNote ? (
              <div
                className={`mx-6 mt-6 rounded-2xl border p-4 ${
                  brief.paymentNote.locked || brief.paymentNote.urgent
                    ? "border-rose-400/40 bg-rose-500/[0.08]"
                    : "border-amber-400/40 bg-amber-400/[0.08]"
                }`}
              >
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {brief.paymentNote.locked
                    ? `Your access is on hold — ${naira(brief.paymentNote.outstanding)} tuition still owing.`
                    : `${naira(brief.paymentNote.outstanding)} of your tuition is still owing.`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                  {brief.paymentNote.locked
                    ? "Settle it from Payments and your classes unlock again straight away."
                    : brief.paymentNote.graceUntil
                      ? `Your branch office has held your access until ${new Date(
                          brief.paymentNote.lockDate,
                        ).toLocaleDateString("en-NG", { day: "numeric", month: "long" })}.`
                      : `Clear it from Payments to keep your seat past ${new Date(
                          brief.paymentNote.lockDate,
                        ).toLocaleDateString("en-NG", { day: "numeric", month: "long" })}${
                          brief.paymentNote.urgent ? ` — that's ${brief.paymentNote.daysToLock} day${
                            brief.paymentNote.daysToLock === 1 ? "" : "s"
                          } away.` : "."
                        }`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    dismiss();
                    router.push("/payments");
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white"
                >
                  Pay now <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            {/* Today's missions. */}
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Today&apos;s missions
                </h3>
                {missions.length > 0 ? (
                  <span className="text-xs font-semibold text-[var(--muted)]">
                    {doneCount}/{missions.length} done
                  </span>
                ) : null}
              </div>

              {missions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No missions set for today — just show up and keep the streak alive.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {missions.map((mi, index) => (
                    <motion.li
                      key={mi.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 + index * 0.1 }}
                      className={`flex items-start gap-3 rounded-2xl border p-3 ${
                        mi.done
                          ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                          : "border-[var(--border)] bg-[var(--surface-alt)]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                          mi.done
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-[var(--accent)]/10 text-[var(--accent)]"
                        }`}
                      >
                        {mi.done ? <CheckCircleIcon className="h-4 w-4" /> : missionIcon(mi.detectType)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-semibold ${
                            mi.done ? "text-[var(--muted)] line-through" : "text-[var(--foreground)]"
                          }`}
                        >
                          {mi.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                          {mi.description}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                          mi.done
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-[var(--accent)]/10 text-[var(--accent)]"
                        }`}
                      >
                        {mi.done ? "Detected ✓" : mi.reward}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                <button
                  onClick={allDone ? dismiss : go}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  {allDone ? "See you tomorrow" : firstUndone ? "Let's go" : "Start today"}
                  {!allDone ? <ArrowRightIcon className="h-4 w-4" /> : null}
                </button>
                {!allDone ? (
                  <button
                    onClick={dismiss}
                    className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
                  >
                    Later
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
