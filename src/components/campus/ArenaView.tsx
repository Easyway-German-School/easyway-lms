"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Avatar from "@/components/Avatar";
import { CampusHeader, CoinChip, Flash, PersonCard, RequestsPanel, useFlash } from "@/components/campus/CampusParts";
import { TargetIcon } from "@/components/icons";
import { REQUEST_TTL_MS, type PresencePerson } from "@/lib/campus";
import { useCampusLive, useRespond, useSendRequest } from "@/lib/useCampus";

/**
 * THE ARENA — Wortduell, a two-player der/die/das race.
 *
 * Three ways in: challenge someone who is online, put out an open call for
 * anyone in your age group, or take a challenge somebody else put out. Whoever
 * sends a challenge waits here — a three-minute window — and is taken straight
 * into the duel the moment somebody accepts.
 */

type Pending = { id: string; label: string; startedAt: number };

export default function ArenaView() {
  const router = useRouter();
  const { live } = useCampusLive("arena", true);
  const send = useSendRequest("arena");
  const respond = useRespond("arena");
  const { message, flash } = useFlash();
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const everyone = useMemo<PresencePerson[]>(() => {
    const seen = new Set<string>();
    const out: PresencePerson[] = [];
    for (const room of Object.values(live?.snapshot?.rooms ?? {})) {
      for (const p of room.people) {
        if (!seen.has(p.userId)) {
          seen.add(p.userId);
          out.push(p);
        }
      }
    }
    return out;
  }, [live?.snapshot]);

  // While a challenge is out: tick the countdown, and ask every 3 seconds whether anyone took it.
  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const ask = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/campus/request/${pending.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; duelId: string | null };
        if (data.status === "accepted" && data.duelId) {
          router.push(`/campus/duel/${data.duelId}`);
        } else if (data.status !== "open") {
          setPending(null);
          flash(data.status === "declined" ? "They're busy right now." : "No takers this time — try again?");
        }
      } catch {
        /* the next tick asks again */
      }
    }, 3000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(ask);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router and flash are stable for this screen
  }, [pending]);

  async function challenge(person: PresencePerson | null) {
    try {
      const result = await send.mutateAsync({ kind: "duel", toUserId: person?.userId ?? null });
      setPending({ id: result.id, label: person ? person.name : "anyone", startedAt: Date.now() });
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not send that.");
    }
  }

  async function cancel() {
    if (!pending) return;
    try {
      await respond.mutateAsync({ id: pending.id, action: "cancel" });
    } catch {
      /* it expires on its own anyway */
    }
    setPending(null);
  }

  async function take(id: string) {
    try {
      const result = await respond.mutateAsync({ id, action: "accept" });
      if (result.duelId) router.push(`/campus/duel/${result.duelId}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Too late — that one's gone.");
    }
  }

  const direct = (live?.requests?.direct ?? []).filter((c) => c.kind === "duel");
  const open = live?.requests?.open ?? [];
  const left = pending ? Math.max(0, Math.ceil((pending.startedAt + REQUEST_TTL_MS.duel - now) / 1000)) : 0;

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <CampusHeader title="Arena" subtitle="Wortduell — eight words, der, die or das" back="/campus" right={<CoinChip balance={live?.balance} />} />

        {pending ? (
          <div className="youth-room-live mt-5 rounded-3xl bg-[#EEEDFE] p-5 text-center text-[#3C3489]">
            <p className="text-xs font-bold uppercase tracking-[0.25em]">Challenge sent</p>
            <p className="mt-2 text-lg font-extrabold">Waiting for {pending.label} to say yes…</p>
            <p className="mt-1 font-mono text-3xl font-black tabular-nums">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </p>
            <button type="button" onClick={cancel} className="mt-3 rounded-full border border-current px-4 py-2 text-sm font-bold">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => challenge(null)}
            disabled={send.isPending}
            className="mt-5 flex w-full items-center justify-between rounded-3xl bg-[var(--accent)] p-5 text-left text-white transition active:scale-[0.98] disabled:opacity-60"
          >
            <span>
              <span className="block text-lg font-extrabold">Challenge anyone</span>
              <span className="block text-sm opacity-90">Put out a call — the first to say yes plays you.</span>
            </span>
            <TargetIcon className="h-8 w-8" />
          </button>
        )}

        <div className="mt-4">
          <RequestsPanel cards={direct} room="arena" onFlash={flash} onDuel={(id) => router.push(`/campus/duel/${id}`)} />
        </div>

        {open.length > 0 ? (
          <section className="mt-6">
            <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Open challenges</h2>
            <ul className="mt-2 space-y-2">
              {open.map((card) => (
                <li key={card.id} className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <Avatar config={card.from.avatar} seed={card.from.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{card.from.name}</p>
                    <p className="text-xs text-[var(--muted)]">{card.from.level} · wants a Wortduell</p>
                  </div>
                  <button type="button" onClick={() => take(card.id)} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-extrabold text-white transition active:scale-95">
                    Take it
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Challenge someone online</h2>
          {everyone.length === 0 ? (
            <p className="mt-3 rounded-3xl border border-dashed border-[var(--border-strong)] p-5 text-center text-sm text-[var(--muted)]">
              Nobody else is on right now. Put out an open call — people see it the moment they arrive.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {everyone.map((person) => (
                <PersonCard key={person.userId} person={person} room="arena" onFlash={flash} onChallenge={challenge} />
              ))}
            </ul>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">Play and win coins — 8 for playing, 7 more for winning, up to five duels a day.</p>
      </div>
      <Flash message={message} />
    </>
  );
}
