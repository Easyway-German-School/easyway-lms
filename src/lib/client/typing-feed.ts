"use client";

import { useEffect, useSyncExternalStore } from "react";
import { startPolling } from "@/lib/client/poll";
import type { Typer } from "@/lib/typing";

/**
 * ONE POLLER, MANY LISTENERS.
 *
 * Three different parts of the screen want to know "who is typing in my class
 * chat right now": the floating pill, the dots on the community button, and the
 * room list inside the hub. If each ran its own poll the server would answer the
 * same question three times every few seconds, per open tab. Instead they all
 * read this store, which polls once and only while somebody is listening.
 *
 * It is a tiny external store (React's `useSyncExternalStore`), which is the
 * right tool when state lives OUTSIDE React and several components render from
 * it: the store owns the data and a subscriber list; a component subscribes on
 * mount and gets a re-render only when the snapshot it reads actually changes.
 * The polling starts when the first component subscribes and stops when the
 * last one leaves — reference counting, so an idle page costs nothing.
 *
 * The office gets `enabled: false` from the server on the first answer, and the
 * store then stops polling altogether (see typingFeedFor).
 */

/**
 * Fired on `window` by the inline chat panel when it opens or closes
 * (`detail: { open: boolean }`), so the floating pill can step aside while the
 * conversation itself is on screen.
 */
export const COMMUNITY_PANEL_EVENT = "easyway:community-panel";

export type TypingRoom = { channelId: string; channelName: string; typers: Typer[] };

export type TypingFeedSnapshot = {
  /** False once the server has said this viewer gets no typing pings (the office). */
  enabled: boolean;
  rooms: TypingRoom[];
  /** Same data keyed by channel, for "is anyone typing in THIS room" lookups. */
  byChannel: Record<string, Typer[]>;
};

const IDLE: TypingFeedSnapshot = { enabled: true, rooms: [], byChannel: {} };
const OFF: TypingFeedSnapshot = { enabled: false, rooms: [], byChannel: {} };

/** How often to ask: quicker while the community screen itself is open. */
const SLOW_MS = 5_000;
const FAST_MS = 2_500;

let snapshot: TypingFeedSnapshot = IDLE;
let signature = "";
let stopPolling: (() => void) | null = null;
let visibilityBound = false;
const listeners = new Set<() => void>();
const subscribers = new Set<{ fast: boolean }>();

function publish(next: TypingFeedSnapshot) {
  // Re-render subscribers only when something they can SEE changed. Most polls
  // answer "nobody is typing", identical to the last one.
  const nextSignature =
    (next.enabled ? "on" : "off") +
    "|" +
    next.rooms.map((room) => `${room.channelId}:${room.typers.map((t) => t.id).join(",")}`).join("|");
  if (nextSignature === signature) return;
  signature = nextSignature;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function buildSnapshot(rooms: TypingRoom[]): TypingFeedSnapshot {
  return {
    enabled: true,
    rooms,
    byChannel: Object.fromEntries(rooms.map((room) => [room.channelId, room.typers])),
  };
}

async function fetchFeed() {
  const res = await fetch("/api/community/typing/feed", { cache: "no-store" });
  if (!res.ok) throw new Error(`typing feed ${res.status}`);
  const data = (await res.json()) as { enabled?: boolean; rooms?: TypingRoom[] };

  if (data.enabled === false) {
    publish(OFF);
    stopLoop();
    return;
  }
  publish(buildSnapshot(Array.isArray(data.rooms) ? data.rooms : []));
}

function onVisibilityChange() {
  // A hidden tab's dots would be stale by the time anyone looked at it. Clear
  // them; the loop refetches the instant the tab is visible again.
  if (document.visibilityState !== "visible" && snapshot.enabled) publish(IDLE);
}

function startLoop() {
  if (stopPolling) return;
  if (!visibilityBound) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = true;
  }
  stopPolling = startPolling(fetchFeed, {
    intervalMs: () => ([...subscribers].some((s) => s.fast) ? FAST_MS : SLOW_MS),
  });
}

function stopLoop() {
  stopPolling?.();
  stopPolling = null;
  if (visibilityBound) {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityBound = false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Who is typing in the viewer's community rooms.
 *
 * `fast` is for the screen whose whole job is the conversation (the hub): it
 * asks every 2.5s instead of 5s while mounted. `active: false` skips
 * subscribing altogether — for components that mount everywhere but only matter
 * for some roles.
 */
export function useTypingFeed(options: { fast?: boolean; active?: boolean } = {}): TypingFeedSnapshot {
  const { fast = false, active = true } = options;

  useEffect(() => {
    if (!active) return;
    const entry = { fast };
    // A new session (different person, same tab) must not inherit "the office
    // gets nothing" from the last one.
    if (subscribers.size === 0) publish(IDLE);
    subscribers.add(entry);
    startLoop();
    return () => {
      subscribers.delete(entry);
      if (subscribers.size === 0) {
        stopLoop();
        publish(IDLE);
      }
    };
  }, [fast, active]);

  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => IDLE,
  );
}
