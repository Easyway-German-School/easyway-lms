"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { BroadcastIcon, VideoIcon } from "@/components/icons";
import { useLiveClass } from "@/lib/useLiveClass";

/**
 * The standing invitation, for the student who has already met the popup.
 *
 * The ringing call is a one-shot: it fires once per class and is deliberately
 * easy to dismiss, because a popup that keeps returning is one people learn to
 * kill on sight. That leaves a gap — the student who waved it away at 09:58
 * while finishing something, and opened the dashboard at 10:04 genuinely
 * meaning to join. This band is for them, and it is the reason dismissing the
 * call is safe to make so easy.
 *
 * It reads from the same shared poll as the call and the sidebar dot, so the
 * three can never disagree about whether a class is on.
 */
export default function LiveClassBanner({ className = "" }: { className?: string }) {
  const { live } = useLiveClass();
  const [minutes, setMinutes] = useState(0);

  // Recomputed on a timer rather than at render, so a dashboard left open does
  // not keep claiming the class started "just now" an hour later.
  useEffect(() => {
    if (!live) return;
    const tick = () => setMinutes(Math.max(0, Math.round((Date.now() - new Date(live.startedAt).getTime()) / 60_000)));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [live]);

  if (!live) return null;

  /**
   * The honest clock, and why it is not hidden.
   *
   * Telling a student they are twenty minutes late is uncomfortable, and the
   * temptation is to leave it out. But a student deciding whether to bother has
   * to know whether they are joining the start or the end, and finding out the
   * hard way — after the effort of joining — is what actually stops them coming
   * back. The framing does the work instead: still time, not you are late.
   */
  const elapsed =
    minutes < 1 ? "Starting right now" : minutes < 5 ? `Started ${minutes} min ago` : `${minutes} minutes in`;
  const stillWorthIt = minutes < 45;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`overflow-hidden rounded-3xl bg-gradient-to-r from-[#0D7C7E] to-[#0D7C7E]/85 shadow-xl ${className}`}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-white">
            <motion.span
              className="absolute inset-0 rounded-2xl border-2 border-white/40"
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 1.9, repeat: Infinity, ease: "easeOut" }}
            />
            <BroadcastIcon className="h-6 w-6" />
          </span>

          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/75">
              {live.personal ? "Your tutor is waiting for you" : "Class in session"}
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] tracking-wider">{elapsed}</span>
            </p>
            <p className="mt-1 truncate text-lg font-semibold text-white">{live.title}</p>
            <p className="truncate text-sm text-white/80">
              {live.tutorName ? `${live.tutorName} is in the room` : "Your classmates are joining now"}
              {stillWorthIt ? " · there is still time" : " · join for the last stretch"}
            </p>
          </div>
        </div>

        <Link
          href={`/live?code=${live.joinCode}`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#0D7C7E] shadow-lg transition hover:brightness-95 active:scale-[0.99]"
        >
          <VideoIcon className="h-4 w-4" />
          Join now
        </Link>
      </div>
    </motion.div>
  );
}
