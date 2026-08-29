"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { BroadcastIcon, CheckCircleIcon, CrossCircleIcon, PendingIcon, SendIcon, VideoIcon } from "@/components/icons";

/**
 * WHO ACTUALLY CAME, while the class is still happening.
 *
 * A tutor standing in an empty video room has one question, and before this the
 * portal could not answer it: has nobody seen the message, or is nobody coming?
 * Those two need opposite responses — one is worth waiting five minutes and
 * ringing again for, the other is worth starting without them — and guessing
 * wrong wastes the lesson either way.
 *
 * So each student is in one of three states, and the tutor can act on each:
 *
 *   RINGING   buzzed, hasn't answered. Ring again, or wait.
 *   JOINED    in the room. Nothing to do.
 *   DECLINED  said no. Stop waiting; start.
 *
 * This is also where a private class stops being a shared room with a URL and
 * becomes a guest list: everybody here was invited by name, and nobody else can
 * get a token at all.
 */

type Invite = {
  studentId: string;
  name: string;
  status: string;
  ringCount: number;
  joinedAt: string | null;
};

type LiveState = {
  id: string;
  title: string;
  joinCode: string;
  kind: string;
  startedAt: string;
  roomName: string;
};

const STATUS_META: Record<string, { label: string; tone: string; Icon: typeof CheckCircleIcon }> = {
  joined: { label: "In the room", tone: "text-emerald-600 bg-emerald-500/10", Icon: CheckCircleIcon },
  declined: { label: "Can't make it", tone: "text-rose-600 bg-rose-500/10", Icon: CrossCircleIcon },
  invited: { label: "Ringing…", tone: "text-amber-600 bg-amber-500/10", Icon: PendingIcon },
};

export default function TutorLivePanel({ className = "" }: { className?: string }) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [ringing, setRinging] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/live/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setLive(data.live ?? null);
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      // A failed poll leaves the last roster on screen. A tutor mid-class does
      // not need a network error where their students' names were.
    }
  }, []);

  /**
   * Ten seconds, which is four times faster than a student polls.
   *
   * Different job, different cost. A student is asking "has it started" and can
   * wait; a tutor is watching names arrive and deciding whether to begin. There
   * is exactly one tutor per room, so the faster poll is one request per ten
   * seconds against a roster of forty doing one per twenty.
   */
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ring = useCallback(
    async (studentIds: string[]) => {
      setRinging(studentIds.join(","));
      try {
        await fetch("/api/live/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ring", studentIds }),
        });
        await load();
      } finally {
        setRinging(null);
      }
    },
    [load],
  );

  if (!live) return null;

  const waiting = invites.filter((invite) => invite.status === "invited");
  const joined = invites.filter((invite) => invite.status === "joined");

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`overflow-hidden rounded-3xl border border-[#0D7C7E]/25 bg-[var(--surface)] shadow-lg ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0D7C7E] to-[#0D7C7E]/85 px-5 py-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
            <motion.span
              className="absolute inset-0 rounded-xl border-2 border-white/40"
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 1.9, repeat: Infinity, ease: "easeOut" }}
            />
            <BroadcastIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">You are live</p>
            <p className="truncate text-base font-semibold">{live.title}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-white/15 px-3 py-1.5 font-mono text-base font-bold tracking-[0.25em]">
            {live.joinCode}
          </span>
          <Link
            href="/live"
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-[#0D7C7E] transition hover:brightness-95"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Open room
          </Link>
        </div>
      </div>

      {invites.length === 0 ? (
        <p className="px-5 py-5 text-sm text-[var(--muted)]">
          Your whole cohort has been buzzed — nobody was rung by name, so there is no guest list to track here. Anyone on
          the roster can walk in.
        </p>
      ) : (
        <div className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {joined.length} of {invites.length} here
            </p>
            {waiting.length > 0 && (
              <button
                onClick={() => ring(waiting.map((invite) => invite.studentId))}
                disabled={Boolean(ringing)}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
              >
                <SendIcon className="h-3.5 w-3.5" />
                Ring the {waiting.length} still missing
              </button>
            )}
          </div>

          <ul className="space-y-1.5">
            {invites.map((invite) => {
              const meta = STATUS_META[invite.status] ?? STATUS_META.invited;
              return (
                <li
                  key={invite.studentId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3.5 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${meta.tone}`}>
                      <meta.Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{invite.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {meta.label}
                        {/* Shown only from the second ring, because "rung once"
                            is not information — it is the baseline. */}
                        {invite.ringCount > 1 && invite.status === "invited" ? ` · rung ${invite.ringCount}×` : ""}
                      </p>
                    </div>
                  </div>

                  {invite.status !== "joined" && (
                    <button
                      onClick={() => ring([invite.studentId])}
                      disabled={Boolean(ringing)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
                    >
                      {ringing === invite.studentId ? "Ringing…" : invite.status === "declined" ? "Ring anyway" : "Ring again"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
