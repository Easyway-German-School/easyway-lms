"use client";

import { useEffect, useRef, useState } from "react";
import { startPolling } from "@/lib/client/poll";
import type { Typer } from "@/lib/typing";

/**
 * A LIVE ENQUIRY: who is typing, and "did anything new arrive?".
 *
 * The open conversation used to re-download the whole thread every 10-15
 * seconds, which is both slow (a reply could sit for 15s) and wasteful (the
 * answer is "nothing new" almost every time). This asks a much smaller question
 * every 3 seconds — /api/support/typing?ticketId= returns just the typers, the
 * message count and the status — and only when the count or status differs from
 * what the screen already holds does it call `onStale` so the caller refetches
 * the thread. A slow full refresh every ~18s still runs as a safety net, which
 * is what picks up an edited message (an edit changes neither count nor status).
 *
 * `known` is what the caller currently displays; pass null until the thread has
 * loaded so the first poll does not race the initial fetch.
 */
const NOBODY: Typer[] = [];

export function useTicketLive(options: {
  ticketId: string | null;
  known: { count: number; status: string } | null;
  onStale: () => Promise<unknown> | void;
}): { typers: Typer[] } {
  const { ticketId, known, onStale } = options;
  // Keyed by ticket, so opening a different conversation shows nobody typing
  // until ITS first answer arrives — no stale dots, and no reset-in-an-effect.
  const [state, setState] = useState<{ id: string | null; typers: Typer[] }>({ id: null, typers: [] });
  const typers = state.id === ticketId ? state.typers : NOBODY;

  const knownRef = useRef(known);
  const staleRef = useRef(onStale);
  useEffect(() => {
    knownRef.current = known;
    staleRef.current = onStale;
  });

  useEffect(() => {
    if (!ticketId) return;

    let tick = 0;
    let refreshing = false;

    return startPolling(
      async () => {
        const res = await fetch(`/api/support/typing?ticketId=${encodeURIComponent(ticketId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`typing ${res.status}`);
        const data = (await res.json()) as {
          typers?: Typer[];
          messageCount?: number;
          status?: string;
        };

        // Only re-render when the set of typers actually changed.
        const next = Array.isArray(data.typers) ? data.typers : [];
        setState((current) =>
          current.id === ticketId && current.typers.map((t) => t.id).join(",") === next.map((t) => t.id).join(",")
            ? current
            : { id: ticketId, typers: next },
        );

        tick += 1;
        const held = knownRef.current;
        const changed =
          held !== null && (data.messageCount !== held.count || (data.status && data.status !== held.status));
        if (held && !refreshing && (changed || tick % 6 === 0)) {
          refreshing = true;
          try {
            await staleRef.current();
          } finally {
            refreshing = false;
          }
        }
      },
      { intervalMs: 3_000 },
    );
  }, [ticketId]);

  return { typers };
}

/**
 * Which of my enquiries have somebody typing in them right now, keyed by ticket
 * id. One poll for a whole list — lights up "Chidi is typing…" on the office
 * queue, the tutor inbox and the student's Help button. `enabled: false` stops
 * it (panel closed, nothing open).
 */
export function useTicketTypingMap(enabled: boolean): Record<string, Typer[]> {
  const [map, setMap] = useState<Record<string, Typer[]>>({});

  useEffect(() => {
    if (!enabled) return;
    return startPolling(
      async () => {
        const res = await fetch("/api/support/typing", { cache: "no-store" });
        if (!res.ok) throw new Error(`typing ${res.status}`);
        const data = (await res.json()) as { tickets?: Record<string, Typer[]> };
        const next = data.tickets ?? {};
        setMap((current) => {
          const sig = (m: Record<string, Typer[]>) =>
            Object.entries(m)
              .map(([id, list]) => `${id}:${list.map((t) => t.id).join(",")}`)
              .sort()
              .join("|");
          return sig(current) === sig(next) ? current : next;
        });
      },
      { intervalMs: 5_000 },
    );
  }, [enabled]);

  // Switched off means nobody is typing, whatever the last answer said.
  return enabled ? map : NO_TICKETS;
}

const NO_TICKETS: Record<string, Typer[]> = {};
