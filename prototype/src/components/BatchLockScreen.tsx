"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";

import { CheckIcon } from "@/components/icons";
import GermanyJourney from "@/components/journey/GermanyJourney";
import Mascot, { type MascotMood } from "@/components/Mascot";
import type { StudentAccess } from "@/lib/access";
import type { SeatStatus } from "@/lib/batch-reservation";
import { studentAccessQueryKey } from "@/lib/useStudentAccess";

/**
 * The waiting room.
 *
 * Shown instead of the padlock when a learner is placed in an intake that has
 * not started (`lockReason === "upcoming_batch"`). It is deliberately NOT the
 * payment wall: the learner has not done anything wrong, the classroom is
 * simply not open yet — so this screen leads with the date and a live
 * countdown, makes the ones who have already paid feel like the early birds
 * they are, and gives the ones who have not a warm, specific reason to pay now
 * (a held seat) rather than a bill.
 *
 * Everything said about numbers is real: the seat number is their rank among
 * learners in the intake by first payment, and "already secured" is a straight
 * count. Nothing here invents scarcity.
 */

type SeatReservation = {
  waiting: boolean;
  firstName?: string;
  seat?: SeatStatus;
  seatNumber?: number | null;
  secured?: number;
  batchLabel?: string;
  tuitionPaid?: number;
  requiredDeposit?: number;
  depositOutstanding?: number;
  balanceOutstanding?: number;
};

function naira(value: number) {
  return `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
}

function ordinal(n: number) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 <= 3 ? n % 10 : 0]}`;
}

function useCountdown(startsOn: string) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(startsOn).getTime() - Date.now()));
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(startsOn).getTime() - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startsOn]);
  const total = Math.floor(remaining / 1000);
  return {
    done: remaining <= 0,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function CountdownTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-[64px] flex-col items-center rounded-2xl border border-white/15 bg-white/[0.07] px-3 py-3 backdrop-blur sm:min-w-[92px] sm:px-5 sm:py-4">
      <span className="font-mono text-3xl font-bold tabular-nums text-white sm:text-5xl">
        {String(value).padStart(2, "0")}
      </span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#FFB27A] sm:text-[11px]">
        {label}
      </span>
    </div>
  );
}

/** A one-day calendar file, so the opening day lands in their phone. */
function calendarHref(startsOn: string, month: string) {
  const start = new Date(startsOn);
  const pad = (n: number) => String(n).padStart(2, "0");
  // The day the classroom opens, as an all-day event in the school's own date.
  const local = new Date(start.getTime() + 60 * 60 * 1000);
  const day = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}`;
  const next = new Date(local.getTime() + 24 * 60 * 60 * 1000);
  const dayAfter = `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EasyWay German School//Intake//EN",
    "BEGIN:VEVENT",
    `UID:easyway-${day}-classes-open@easywayschoollms.com.ng`,
    `DTSTAMP:${day}T000000Z`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${dayAfter}`,
    `SUMMARY:EasyWay ${month} classes begin`,
    "DESCRIPTION:Your classroom opens today. Sign in to the EasyWay portal.",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

const MOOD: Record<SeatStatus, MascotMood> = {
  paid_in_full: "celebrating",
  deposit_paid: "proud",
  registration_only: "cheerful",
  unpaid: "greeting",
};

export default function BatchLockScreen({ access }: { access: (StudentAccess & { hasPhoto?: boolean }) | null }) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const startsOn = access?.batchStartsOn ?? null;
  const countdown = useCountdown(startsOn ?? new Date().toISOString());

  const { data } = useQuery<SeatReservation>({
    queryKey: ["student", "seat-reservation"],
    queryFn: async () => {
      const response = await fetch("/api/student/seat-reservation", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read seat state");
      return response.json();
    },
    staleTime: 60_000,
  });

  // The doors open on their own: when the clock reaches zero, re-ask the server
  // and the shell lets them in without a reload.
  useEffect(() => {
    if (startsOn && countdown.done) {
      queryClient.invalidateQueries({ queryKey: studentAccessQueryKey });
    }
  }, [countdown.done, startsOn, queryClient]);

  const batchLabel = access?.batchLabel ?? data?.batchLabel ?? "your";
  const month = batchLabel.split(" ")[0] || "upcoming";
  const seat: SeatStatus = data?.seat ?? (access?.registrationPaid ? "registration_only" : "unpaid");
  const name = data?.firstName ? `, ${data.firstName}` : "";
  const secured = data?.secured ?? 0;
  const seatNumber = data?.seatNumber ?? null;
  const deposit = data?.requiredDeposit ?? access?.requiredDeposit ?? 0;
  const depositLeft = data?.depositOutstanding ?? access?.outstanding ?? 0;
  const balanceLeft = data?.balanceOutstanding ?? access?.outstandingBalance ?? 0;
  const paidTowardDeposit = deposit > 0 ? Math.min(100, Math.round(((deposit - depositLeft) / deposit) * 100)) : 0;
  const opensOn = startsOn
    ? new Date(startsOn).toLocaleDateString("en-NG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Lagos",
      })
    : "the first day of the intake";
  const founding = seatNumber !== null && seatNumber <= 10;

  const headline: Record<SeatStatus, string> = {
    paid_in_full: `Your ${month} seat is locked in${name}.`,
    deposit_paid: `Your ${month} seat is reserved${name}.`,
    registration_only: `You're on the ${month} list${name} — one step to hold your seat.`,
    unpaid: `Your ${month} spot is waiting${name}.`,
  };

  const beccaLine: Record<SeatStatus, string> = {
    paid_in_full:
      seatNumber !== null
        ? `You paid in full and you were the ${ordinal(seatNumber)} learner to secure a ${month} seat. There is nothing left to do but count down — I will open the classroom the second the clock hits zero.`
        : `You paid in full, so there is nothing left to do but count down. I will open the classroom the second the clock hits zero.`,
    deposit_paid: `Your deposit is in, so the seat is yours${seatNumber !== null ? ` — number ${seatNumber} in the ${month} intake` : ""}. The remaining ${naira(balanceLeft)} is due within your first month of classes, and you can clear it any time from Payments.`,
    registration_only: `Your registration is in, and I have put your name on the ${month} list. A seat is only held once the ${naira(deposit)} deposit is paid — ${
      depositLeft > 0 ? `you have ${naira(depositLeft)} to go` : "you are almost there"
    }. Do it now and the seat is officially yours.`,
    unpaid: `You are signed up for the ${month} intake, but no payment has landed yet, so your seat is not held.${
      secured > 0 ? ` ${secured} ${secured === 1 ? "learner has" : "learners have"} already secured theirs.` : " Be one of the first to secure yours."
    } Pay the ${naira(deposit)} deposit and it is yours.`,
  };

  const needsPayment = seat === "unpaid" || seat === "registration_only";
  const showBalanceCta = seat === "deposit_paid" && balanceLeft > 0;

  return (
    <>
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(255,102,0,0.32),_transparent_55%),linear-gradient(165deg,_#020617_0%,_#061920_50%,_#020617_100%)]" />
        {!reduceMotion &&
          [0, 1, 2, 3, 4, 5].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full bg-[#FFB27A]/70"
              style={{ left: `${10 + i * 16}%`, top: `${18 + ((i * 23) % 60)}%`, height: 4 + (i % 3) * 2, width: 4 + (i % 3) * 2 }}
              animate={{ y: [0, -24, 0], opacity: [0.1, 0.7, 0.1] }}
              transition={{ duration: 6 + i, repeat: Infinity, delay: i * 0.6, ease: "easeInOut" }}
            />
          ))}

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-12 text-center sm:py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#FF9d5c]">
            {batchLabel === "your" ? "Upcoming intake" : `${batchLabel} intake`}
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">{headline[seat]}</h1>
          <p className="mt-2 text-sm text-white/65 sm:text-base">Classes open {opensOn}</p>

          {/* The countdown */}
          <div className="mt-8 flex items-stretch justify-center gap-2 sm:gap-4" role="timer" aria-label="Time until your classes open">
            <CountdownTile value={countdown.days} label="Days" />
            <CountdownTile value={countdown.hours} label="Hours" />
            <CountdownTile value={countdown.minutes} label="Minutes" />
            <CountdownTile value={countdown.seconds} label="Seconds" />
          </div>

          {/* Becca */}
          <div className="mt-10 flex w-full flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-2">
            <motion.div
              initial={reduceMotion ? false : { x: -50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 80, damping: 15 }}
              className="shrink-0"
            >
              <Mascot mood={MOOD[seat]} className="h-40 w-40 sm:h-52 sm:w-52" />
            </motion.div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, type: "spring", stiffness: 120, damping: 16 }}
              className="relative flex-1 rounded-[26px] border border-white/15 bg-white/[0.07] p-6 text-left shadow-[0_30px_80px_rgba(2,6,23,0.5)] backdrop-blur-xl"
            >
              <span className="absolute -left-2 top-1/2 hidden h-5 w-5 -translate-y-1/2 rotate-45 border-b border-l border-white/15 bg-white/[0.07] sm:block" />

              {seatNumber !== null && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#FF6600] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
                    Seat #{seatNumber}
                  </span>
                  {founding && (
                    <span className="rounded-full border border-[#FFB27A]/50 bg-[#FF9d5c]/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#FFD2AE]">
                      Founding {month} learner
                    </span>
                  )}
                  {secured > 0 && (
                    <span className="text-xs text-white/60">of {secured} secured so far</span>
                  )}
                </div>
              )}

              <p className="text-base leading-7 text-white/90 sm:text-[17px]">{beccaLine[seat]}</p>

              {needsPayment && deposit > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
                    <span>Towards holding your seat</span>
                    <span>{paidTowardDeposit}%</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#FF6600] to-[#0D7C7E]"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(paidTowardDeposit, 3)}%` }}
                      transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-white/60">
                    {naira(deposit - depositLeft)} of {naira(deposit)} deposit
                  </p>
                </div>
              )}

              {(seat === "paid_in_full" || seat === "deposit_paid") && (
                <div className="mt-5 flex items-center gap-3 text-sm text-emerald-200">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/20">
                    <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
                  </span>
                  {seat === "paid_in_full" ? "Tuition paid in full" : "Deposit received — seat held"}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                {needsPayment && (
                  <Link
                    href="/programs"
                    className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/30 transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    Reserve my {month} seat
                  </Link>
                )}
                {showBalanceCta && (
                  <Link
                    href="/programs"
                    className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/30 transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    Pay my balance early
                  </Link>
                )}
                {startsOn && (
                  <a
                    href={calendarHref(startsOn, month)}
                    download={`easyway-${month.toLowerCase()}-classes.ics`}
                    className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    Add opening day to my calendar
                  </a>
                )}
                <Link
                  href="/payments"
                  className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  View my payments
                </Link>
              </div>
            </motion.div>
          </div>

          {/* While they wait */}
          <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
            <Link
              href="/profile"
              className="rounded-2xl border border-white/15 bg-white/[0.05] p-4 transition hover:bg-white/[0.09]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FFB27A]">Get ready</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {access?.hasPhoto === false ? "Add your profile photo" : "Check your profile"}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/60">
                {access?.hasPhoto === false
                  ? "The classroom needs a photo on file — do it now so opening day is instant."
                  : "Make sure your details are right before your first class."}
              </p>
            </Link>
            <Link
              href="/notifications"
              className="rounded-2xl border border-white/15 bg-white/[0.05] p-4 transition hover:bg-white/[0.09]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FFB27A]">Stay in the loop</p>
              <p className="mt-1 text-sm font-semibold text-white">Turn on notifications</p>
              <p className="mt-1 text-xs leading-5 text-white/60">
                I will tell you the moment the doors open, and remind you as the day gets close.
              </p>
            </Link>
          </div>
        </div>
      </div>

      <section className="border-t border-[var(--border)] bg-[var(--background)] px-4 py-12 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--muted)]">
            The road ahead — this is where it goes
          </p>
          <GermanyJourney variant="inline" />
        </div>
      </section>
    </>
  );
}
