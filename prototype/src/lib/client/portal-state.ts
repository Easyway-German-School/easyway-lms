"use client";

import { useSyncExternalStore } from "react";
import type { LiveStateResult } from "@/lib/live-state";

/**
 * THE COMMUNITY BADGE NUMBER, READ FROM A TICK THAT WAS ALREADY RUNNING.
 *
 * `loadPortalUpdates` (src/lib/portal-updates.ts) computes the unread total
 * as part of its normal query — it has to, to build the "N unread" state —
 * and until now `PortalUpdates.tsx` threw that number away. Four separate
 * components (`CommunityLauncher`, and the Student/Lecturer/Admin shells)
 * then ran their OWN poll of `/api/community/unread` to ask the same
 * question again, 120s apart, from a page that `PortalUpdates` was already
 * ticking on every 12s. This store lets them read the number that already
 * exists instead of re-asking for it.
 *
 * `PortalUpdates.tsx` is mounted once per shell and lives for the whole
 * session (push or poll, the ingest path is shared), so by the time any
 * consumer below renders, a real recent value is already here.
 */

let unread = 0;
const listeners = new Set<() => void>();

export function publishUnread(next: number) {
  if (next === unread) return;
  unread = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, () => unread, () => 0);
}

/**
 * Whether the push connection is currently live — set by PortalUpdates.tsx,
 * the one component that owns the actual WebSocket. Other consumers (like
 * useLiveClass below) read this to decide whether to trust pushed data or
 * keep polling, without each needing their own connection.
 */
let pushHealthy = false;
const healthListeners = new Set<() => void>();

export function publishPushHealthy(next: boolean) {
  if (next === pushHealthy) return;
  pushHealthy = next;
  healthListeners.forEach((listener) => listener());
}

function subscribeHealth(listener: () => void) {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

export function usePushHealthy(): boolean {
  return useSyncExternalStore(subscribeHealth, () => pushHealthy, () => false);
}

/**
 * "IS MY CLASS LIVE RIGHT NOW", PUSHED ALONGSIDE THE SAME TICK.
 *
 * Bundled onto the push server's per-user tick (push-server/server.ts) next
 * to portal updates, rather than its own timer — one connection answers
 * both questions. `null` means "no push message has arrived yet (or push
 * isn't connected)", which callers read the same way as "haven't polled
 * yet" — never rendered as "nothing is live", only as "don't know".
 */
let liveState: LiveStateResult | null = null;
let liveStateReceived = false;
const liveListeners = new Set<() => void>();

export function publishLiveState(next: LiveStateResult | null | undefined) {
  liveStateReceived = true;
  liveState = next ?? null;
  liveListeners.forEach((listener) => listener());
}

function subscribeLive(listener: () => void) {
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
}

/** `received` is false until the first push message lands — callers use it to decide whether to trust `state` yet or keep polling. */
export function useLiveStatePush(): { state: LiveStateResult | null; received: boolean } {
  return useSyncExternalStore(
    subscribeLive,
    () => ({ state: liveState, received: liveStateReceived }),
    () => ({ state: null, received: false }),
  );
}
