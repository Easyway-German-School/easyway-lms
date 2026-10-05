"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  HEARTBEAT_MS,
  SNAPSHOT_REFRESH_MS,
  type CampusSnapshot,
  type PresenceRoom,
  type RequestKind,
} from "@/lib/campus";
import type { RequestCard } from "@/lib/campus-server";

/**
 * The client side of Campus. Two cadences, and the difference is the cost:
 *
 *   useCampusBeat   — everywhere in the portal. A few bytes, every ~90 seconds,
 *                     and only while the tab is visible (react-query pauses
 *                     interval refetches in a background tab, which is exactly
 *                     the behaviour wanted). Keeps the student "online" and
 *                     brings back the number on the Campus tab's badge.
 *   useCampusLive   — only on a Campus screen. Every ~30 seconds, and the same
 *                     request is also the heartbeat, so watching the campus is
 *                     one call per half minute, not two.
 *
 * Neither ever runs for a student who is not on the new look or whose portal is
 * locked — the caller decides `enabled`.
 */

export type BeatState = {
  ok: boolean;
  reason?: "not_student" | "locked" | "off";
  incoming?: number;
  balance?: number | null;
  /** Whether this student is currently set to appear offline. */
  hidden?: boolean;
};

export type LiveState = BeatState & {
  snapshot?: CampusSnapshot;
  requests?: { direct: RequestCard[]; open: RequestCard[] };
};

async function post(room: PresenceRoom, full: boolean, hidden?: boolean): Promise<LiveState> {
  const response = await fetch("/api/campus/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, full, ...(hidden === undefined ? {} : { hidden }) }),
    cache: "no-store",
  });
  if (response.status === 403) return { ok: false, reason: "not_student" };
  if (!response.ok) throw new Error("Campus is unavailable");
  return response.json();
}

export const campusBeatKey = ["campus", "beat"] as const;
export const campusLiveKey = (room: PresenceRoom) => ["campus", "live", room] as const;

export function useCampusBeat(enabled: boolean) {
  const query = useQuery<LiveState>({
    queryKey: campusBeatKey,
    queryFn: () => post("lobby", false),
    enabled,
    refetchInterval: HEARTBEAT_MS,
    staleTime: HEARTBEAT_MS - 5_000,
    // A flaky signal is not worth three retries and a console full of red.
    retry: false,
  });
  return { incoming: query.data?.incoming ?? 0, balance: query.data?.balance ?? null, on: Boolean(query.data?.ok) };
}

export function useCampusLive(room: PresenceRoom, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery<LiveState>({
    queryKey: campusLiveKey(room),
    queryFn: async () => {
      const data = await post(room, true);
      // The same call counts as a heartbeat; keep the tab badge in step with it.
      queryClient.setQueryData<LiveState>(campusBeatKey, (old) => ({ ...(old ?? { ok: true }), ok: data.ok, incoming: data.incoming, balance: data.balance ?? old?.balance }));
      return data;
    },
    enabled,
    refetchInterval: SNAPSHOT_REFRESH_MS,
    staleTime: SNAPSHOT_REFRESH_MS - 5_000,
    retry: false,
  });
  return { ...query, live: query.data };
}

/** Appear offline (or come back). Takes effect on the next heartbeat, which this sends immediately. */
export function useGhost(room: PresenceRoom) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hidden: boolean) => post(room, true, hidden),
    onSuccess: (data) => queryClient.setQueryData(campusLiveKey(room), data),
  });
}

export function useSendRequest(room: PresenceRoom) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; duplicate: boolean }, Error, { kind: RequestKind; toUserId?: string | null }>({
    mutationFn: async (input) => {
      const response = await fetch("/api/campus/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not send that.");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campusLiveKey(room) }),
  });
}

export function useRespond(room: PresenceRoom) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean; duelId: string | null }, Error, { id: string; action: "accept" | "decline" | "cancel" }>({
    mutationFn: async ({ id, action }) => {
      const response = await fetch(`/api/campus/request/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not do that.");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campusLiveKey(room) }),
  });
}
