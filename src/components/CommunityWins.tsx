"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CertificateIcon,
  ChainIcon,
  CrossIcon,
  LevelUpIcon,
  TrophyIcon,
} from "@/components/icons";

/**
 * THE WINS STRIP — a thin band of good news above a room's messages.
 *
 * Ambient, not an interruption. It is read-only, it is derived entirely from
 * things that already happened (a finished class story, a classmate's
 * certificate, a level completed — see /api/community/wins), and it can be put
 * away. The point is small and specific: the first thing a student sees when
 * they open their class group is a reason the class is worth staying in, in the
 * words of the people sitting next to them.
 *
 * Dismissal is per-device and per-cohort, and it RE-OPENS when a genuinely new
 * win lands — the stored key includes the newest win's id, so "I closed this"
 * does not also mean "never show me that my classmate passed on Thursday".
 */

type Win = {
  id: string;
  kind: "story" | "certificate" | "level";
  name: string;
  detail: string;
  at: string;
  link?: string;
};

const DISMISS_PREFIX = "easyway:community-wins-dismissed:";
/** A win newer than this gets the one-off confetti when the strip first paints. */
const FRESH_MS = 2 * 60 * 60 * 1000;

function iconFor(kind: Win["kind"]) {
  if (kind === "certificate") return CertificateIcon;
  if (kind === "level") return LevelUpIcon;
  return ChainIcon;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default function CommunityWins({ spaceId }: { spaceId: string | null }) {
  const [wins, setWins] = useState<Win[]>([]);
  const [dismissed, setDismissed] = useState(true);
  const [burst, setBurst] = useState(false);
  const burstedFor = useRef<string | null>(null);

  const newestId = wins[0]?.id ?? "";
  const storageKey = spaceId ? `${DISMISS_PREFIX}${spaceId}` : null;

  useEffect(() => {
    if (!spaceId) {
      setWins([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/community/wins?spaceId=${encodeURIComponent(spaceId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setWins(Array.isArray(data.wins) ? data.wins : []);
      } catch {
        // A strip that fails to load is nothing — the room is fine without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Whether this device has put the strip away for this exact set of wins.
  useEffect(() => {
    if (!storageKey || !newestId) {
      setDismissed(true);
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(storageKey) === newestId);
    } catch {
      setDismissed(false);
    }
  }, [storageKey, newestId]);

  // One gentle confetti burst, only when a brand-new win is on screen and only
  // once per win.
  useEffect(() => {
    if (dismissed || !newestId || burstedFor.current === newestId) return;
    const fresh = wins.some((w) => Date.now() - new Date(w.at).getTime() < FRESH_MS);
    if (!fresh) return;
    burstedFor.current = newestId;
    setBurst(true);
    const timer = window.setTimeout(() => setBurst(false), 1100);
    return () => window.clearTimeout(timer);
  }, [dismissed, newestId, wins]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (!storageKey || !newestId) return;
    try {
      window.localStorage.setItem(storageKey, newestId);
    } catch {
      // Private browsing — it stays gone for this visit, which is enough.
    }
  }, [storageKey, newestId]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: `${(i / 16) * 100 + (i % 3) * 4}%`,
        delay: `${(i % 5) * 40}ms`,
        hue: ["var(--accent)", "#f59e0b", "#10b981", "#ec4899", "#6366f1"][i % 5],
        drift: `${(i % 2 ? 1 : -1) * (8 + (i % 4) * 6)}px`,
      })),
    [],
  );

  if (!spaceId || dismissed || wins.length === 0) return null;

  return (
    <div className="relative border-b border-[var(--border)] bg-[var(--surface-alt)]/60">
      {burst ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 overflow-hidden" aria-hidden>
          <style>{`
            @keyframes wins-confetti {
              0% { transform: translateY(-12px) rotate(0deg); opacity: 0; }
              15% { opacity: 1; }
              100% { transform: translateY(56px) rotate(220deg); opacity: 0; }
            }
          `}</style>
          {confetti.map((c, i) => (
            <span
              key={i}
              className="absolute top-0 block h-1.5 w-1.5 rounded-[1px]"
              style={{
                left: c.left,
                background: c.hue,
                marginLeft: c.drift,
                animation: `wins-confetti 1s ease-in ${c.delay} both`,
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
          <TrophyIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
          Wins
        </span>

        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
          {wins.map((win) => {
            const Icon = iconFor(win.kind);
            const inner = (
              <>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-[var(--foreground)]">
                    {win.name} {win.detail}
                  </span>
                  <span className="block text-[10px] text-[var(--muted)]">{timeAgo(win.at)}</span>
                </span>
              </>
            );
            const className =
              "flex shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 max-w-[16rem]";
            return win.link ? (
              <a key={win.id} href={win.link} className={`${className} transition hover:border-[var(--accent)]`}>
                {inner}
              </a>
            ) : (
              <span key={win.id} className={className}>
                {inner}
              </span>
            );
          })}
        </div>

        <button
          onClick={dismiss}
          aria-label="Hide wins"
          className="shrink-0 rounded-lg p-1 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
        >
          <CrossIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
