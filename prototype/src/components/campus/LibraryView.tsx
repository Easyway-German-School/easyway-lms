"use client";

import { useEffect, useRef, useState } from "react";

import { CampusHeader, CoinChip, FaceRow, Flash, useFlash } from "@/components/campus/CampusParts";
import { YouthBlobs, YouthFace } from "@/components/youth/YouthMotion";
import { BREAK_MS, FOCUS_MS, clock, focusPhase } from "@/lib/campus";
import { useCampusLive } from "@/lib/useCampus";

/**
 * THE LIBRARY — studying alongside people you can see.
 *
 * No voice, no chat, no server in the timer. Every half hour is 25 minutes of
 * focus then 5 of break, read straight off the clock, so everyone in the room
 * is on the same beat without anything being sent anywhere. What makes it work
 * is the faces: "nine people are studying right now" is a reason to open a book.
 */
export default function LibraryView() {
  const { live } = useCampusLive("library", true);
  const { message, flash } = useFlash(4200);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = focusPhase(now);
  const total = phase.phase === "focus" ? FOCUS_MS : BREAK_MS;
  const progress = 1 - phase.remainingMs / total;

  // A focus block earns coins only if you were here when it STARTED (give or take a few minutes) — and only once.
  const joinedAt = useRef(Date.now());
  const claimed = useRef(new Set<number>());
  useEffect(() => {
    if (phase.phase !== "break") return;
    const cycleStart = phase.cycle * (FOCUS_MS + BREAK_MS);
    if (claimed.current.has(phase.cycle) || joinedAt.current > cycleStart + 3 * 60_000) return;
    claimed.current.add(phase.cycle);
    fetch("/api/campus/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycle: phase.cycle }),
    })
      .then((r) => r.json())
      .then((data: { coins?: number }) => {
        if (data.coins && data.coins > 0) flash(`Focus block done — +${data.coins} coins`);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `flash` is stable enough for a one-shot claim
  }, [phase.phase, phase.cycle]);

  const here = live?.snapshot?.rooms.library;
  const people = here?.people ?? [];
  const focusing = phase.phase === "focus";

  return (
    <>
      <div className="relative isolate mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <YouthBlobs />
        <CampusHeader title="Library" subtitle="Silent study, everyone on the same clock" back="/campus" right={<CoinChip balance={live?.balance} />} />

        <div
          className={`relative mt-5 rounded-[2rem] p-6 text-center ${focusing ? "youth-room-live" : "youth-pop"}`}
          style={{ background: focusing ? "#E1F5EE" : "#FAEEDA", color: focusing ? "#085041" : "#633806" }}
        >
          <p className="text-xs font-bold uppercase tracking-[0.25em]">{focusing ? "Focus" : "Break"}</p>
          <p className="mt-2 font-mono text-6xl font-black tabular-nums" aria-live="off">
            {clock(phase.remainingMs)}
          </p>
          <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-current transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-4 text-sm">
            {focusing
              ? "Put your phone face-down and work. Everyone in here is on this same timer."
              : "Stand up, drink some water. The next focus block starts on the half hour."}
          </p>
        </div>

        <section className="mt-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">In the Library</h2>
            <span className="text-xs font-semibold text-[var(--muted)]">{here ? `${here.count} here` : ""}</span>
          </div>

          {people.length === 0 ? (
            <p className="mt-3 rounded-3xl border border-dashed border-[var(--border-strong)] p-5 text-center text-sm text-[var(--muted)]">
              {here && here.count > 0 ? "It's just you in here — others will join when they see the room is open." : "Just you for now. You're holding the room open for everyone else."}
            </p>
          ) : (
            <div className="mt-3">
              <FaceRow people={people} more={here?.more ?? 0} size={36} />
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {people.map((person) => (
                  <li key={person.userId} className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
                    <YouthFace config={person.avatar} seed={person.name} size={36} live />
                    <span className="min-w-0 truncate text-sm font-bold">{person.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">Finish a focus block here and earn a few coins — up to four a day.</p>
      </div>
      <Flash message={message} />
    </>
  );
}
