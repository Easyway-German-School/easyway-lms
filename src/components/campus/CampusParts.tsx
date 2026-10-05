"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import Avatar from "@/components/Avatar";
import { BellIcon, ChevronLeftIcon, CoinIcon, CrossIcon, EyeIcon, EyeOffIcon, HandIcon, TargetIcon } from "@/components/icons";
import { usePushNotifications } from "@/lib/use-push";
import type { PresencePerson } from "@/lib/campus";
import type { RequestCard } from "@/lib/campus-server";
import { useRespond, useSendRequest } from "@/lib/useCampus";
import type { PresenceRoom } from "@/lib/campus";

/** A short message that clears itself — the only feedback Campus needs for a tap. */
export function useFlash(ms = 3200) {
  const [message, setMessage] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const flash = (text: string) => {
    setMessage(text);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(""), ms);
  };
  return { message, flash };
}

export function CoinChip({ balance }: { balance: number | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-soft)] px-3 py-1.5 text-sm font-extrabold text-[var(--warning)]">
      <CoinIcon className="h-4 w-4" strokeWidth={2.2} />
      {typeof balance === "number" ? balance.toLocaleString() : "—"}
    </span>
  );
}

export function CampusHeader({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link href={back} className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--muted)]">
            <ChevronLeftIcon className="h-3.5 w-3.5" /> Campus
          </Link>
        ) : null}
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** "Appear offline" — a student's right to be on Campus without being seen on it. */
export function GhostToggle({ hidden, busy, onChange }: { hidden: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onChange(!hidden)}
      aria-pressed={hidden}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-bold text-[var(--foreground-soft)] transition active:scale-95 disabled:opacity-60"
    >
      {hidden ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
      {hidden ? "Hidden" : "Visible"}
    </button>
  );
}

/** Faces in a row, with a +N for the rest. */
export function FaceRow({ people, more = 0, size = 28 }: { people: PresencePerson[]; more?: number; size?: number }) {
  if (people.length === 0 && more === 0) return null;
  return (
    <span className="flex items-center">
      {people.slice(0, 5).map((p, i) => (
        <span key={p.userId} className={i === 0 ? "" : "-ml-2"} style={{ zIndex: 10 - i }}>
          <Avatar config={p.avatar} seed={p.name} size={size} className="rounded-full ring-2 ring-[var(--surface)]" />
        </span>
      ))}
      {more + Math.max(0, people.length - 5) > 0 ? (
        <span className="-ml-2 grid place-items-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[10px] font-bold text-[var(--muted)] ring-2 ring-[var(--surface)]" style={{ height: size, minWidth: size }}>
          +{more + Math.max(0, people.length - 5)}
        </span>
      ) : null}
    </span>
  );
}

/** Somebody who is online, with the two things you can do about it. */
export function PersonCard({
  person,
  room,
  onFlash,
  onChallenge,
}: {
  person: PresencePerson;
  room: PresenceRoom;
  onFlash: (text: string) => void;
  /** Present only where a challenge makes sense (the Arena); it owns the pending state. */
  onChallenge?: (person: PresencePerson) => void;
}) {
  const send = useSendRequest(room);
  const [waved, setWaved] = useState(false);

  async function wave() {
    try {
      await send.mutateAsync({ kind: "wave", toUserId: person.userId });
      setWaved(true);
      onFlash(`You waved at ${person.name}`);
    } catch (error) {
      onFlash(error instanceof Error ? error.message : "Could not wave.");
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <Avatar config={person.avatar} seed={person.name} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold">{person.name}</p>
        <p className="text-xs text-[var(--muted)]">
          {person.level}
          {person.room !== "lobby" ? ` · in the ${person.room === "exam" ? "Prüfungsraum" : person.room[0].toUpperCase() + person.room.slice(1)}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={wave}
        disabled={send.isPending || waved}
        aria-label={`Wave at ${person.name}`}
        className="grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--foreground-soft)] transition active:scale-90 disabled:opacity-50"
      >
        <HandIcon className="h-5 w-5" />
      </button>
      {onChallenge ? (
        <button
          type="button"
          onClick={() => onChallenge(person)}
          aria-label={`Challenge ${person.name}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-sm font-extrabold text-white transition active:scale-95"
        >
          <TargetIcon className="h-4 w-4" /> Duel
        </button>
      ) : null}
    </li>
  );
}

/** Requests aimed at me — a wave to answer, or a challenge to take. */
export function RequestsPanel({
  cards,
  room,
  onFlash,
  onDuel,
}: {
  cards: RequestCard[];
  room: PresenceRoom;
  onFlash: (text: string) => void;
  onDuel: (duelId: string) => void;
}) {
  const respond = useRespond(room);
  const send = useSendRequest(room);
  if (cards.length === 0) return null;

  async function answer(card: RequestCard, action: "accept" | "decline") {
    try {
      const result = await respond.mutateAsync({ id: card.id, action });
      if (action === "accept" && result.duelId) onDuel(result.duelId);
    } catch (error) {
      onFlash(error instanceof Error ? error.message : "Could not do that.");
    }
  }

  async function waveBack(card: RequestCard) {
    try {
      await respond.mutateAsync({ id: card.id, action: "accept" });
      await send.mutateAsync({ kind: "wave", toUserId: card.from.userId });
      onFlash(`You waved back at ${card.from.name}`);
    } catch (error) {
      onFlash(error instanceof Error ? error.message : "Could not wave back.");
    }
  }

  return (
    <ul className="space-y-2">
      {cards.map((card) => (
        <li key={card.id} className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/8 p-3">
          <div className="flex items-center gap-3">
            <Avatar config={card.from.avatar} seed={card.from.name} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold leading-tight">
                {card.from.name} {card.kind === "wave" ? "waved at you" : "wants a Wortduell"}
              </p>
              <p className="text-xs text-[var(--muted)]">{card.from.level}</p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {card.kind === "wave" ? (
              <>
                <button type="button" onClick={() => answer(card, "decline")} className="rounded-full px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                  Dismiss
                </button>
                <button type="button" onClick={() => waveBack(card)} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-extrabold text-white transition active:scale-95">
                  Wave back
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => answer(card, "decline")} className="rounded-full px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                  Not now
                </button>
                <button type="button" onClick={() => answer(card, "accept")} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-extrabold text-white transition active:scale-95">
                  Play
                </button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Flash({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 lg:bottom-8">
      <span className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--surface)] shadow-lg">{message}</span>
    </div>
  );
}

const ALERTS_DISMISSED_KEY = "ew:campus-alerts-dismissed";

/**
 * "Get a buzz when someone challenges you" — an inline card, never a popup.
 *
 * The browser gives exactly one permission prompt and a "Block" is forever, so
 * this asks at the one moment the answer is obviously yes: on the screen where
 * waves and challenges happen, in words about THEM ("when someone challenges
 * you"), with "Not now" as plain as "Turn on". The native prompt only appears
 * after they have tapped yes here. Said no once, it does not come back.
 */
export function CampusAlertsCard() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we have read storage

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(ALERTS_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || push.enabled || push.permission === "denied") return null;
  if (!push.supported && !push.needsInstall) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(ALERTS_DISMISSED_KEY, "1");
    } catch {
      /* private mode — it simply shows next time */
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-strong)]/12 text-[var(--accent-strong)]">
        <BellIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold leading-tight">Get a buzz when someone challenges you</p>
        <p className="text-xs text-[var(--muted)]">
          {push.needsInstall
            ? "On iPhone, add EasyWay to your Home Screen first, then come back here."
            : "A few a day at most, never at night. You can turn it off any time."}
        </p>
      </div>
      {push.needsInstall ? null : (
        <button
          type="button"
          disabled={push.busy}
          onClick={() => void push.enable()}
          className="rounded-full bg-[var(--accent)] px-3.5 py-2 text-sm font-extrabold text-white transition active:scale-95 disabled:opacity-60"
        >
          {push.busy ? "…" : "Turn on"}
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Not now" className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-alt)]">
        <CrossIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
