"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import type { AvatarConfig } from "@/lib/avatar";
import type { Look } from "@/lib/youth-look";

export const lookQueryKey = ["student", "look"] as const;

export type LookState = {
  look: Look;
  reason: "chosen" | "wave" | "default";
  inWave: boolean;
  avatar: AvatarConfig | null;
  name: string | null;
};

/**
 * The last answer, kept in this browser so the next page load paints the right
 * layout from its first frame. Without it, a student on the new look would see
 * the classic sidebar flash for the length of one request on every visit. It is
 * only ever a head start — the server's answer replaces it as soon as it lands.
 */
const CACHE_KEY = "easyway-look";

function readCache(): LookState | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LookState;
    return parsed && (parsed.look === "youth" || parsed.look === "classic") ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(state: LookState | null) {
  try {
    if (state) window.localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* Private mode or a full disk: the head start is optional. */
  }
}

/**
 * Which portal look this student has, and their avatar.
 *
 * Goes through react-query for the same reason useStudentAccess does: the shell
 * remounts on every client navigation, and a shared cache means one request,
 * not one per page.
 */
export function useLook() {
  const queryClient = useQueryClient();
  const { status } = useSession();

  // Read after mount, never during render, so server and client markup agree.
  const [cached, setCached] = useState<LookState | null>(null);
  useEffect(() => setCached(readCache()), []);

  const query = useQuery<LookState>({
    queryKey: lookQueryKey,
    enabled: status === "authenticated",
    queryFn: async () => {
      const response = await fetch("/api/student/look", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read look");
      const data = (await response.json()) as LookState;
      writeCache(data);
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const state = query.data ?? cached;

  const setLook = useCallback(
    async (choice: Look | null) => {
      const response = await fetch("/api/student/look", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ look: choice }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not change the look");
      }
      const data = (await response.json()) as LookState;
      writeCache(data);
      queryClient.setQueryData(lookQueryKey, data);
      return data;
    },
    [queryClient],
  );

  const saveAvatar = useCallback(
    async (avatar: AvatarConfig) => {
      const response = await fetch("/api/student/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not save your avatar");
      }
      const saved = (await response.json()).avatar as AvatarConfig;
      const current = queryClient.getQueryData<LookState>(lookQueryKey);
      if (current) {
        const next = { ...current, avatar: saved };
        writeCache(next);
        queryClient.setQueryData(lookQueryKey, next);
      } else {
        await queryClient.invalidateQueries({ queryKey: lookQueryKey });
      }
      return saved;
    },
    [queryClient],
  );

  return {
    look: (state?.look ?? "classic") as Look,
    reason: state?.reason ?? "default",
    inWave: state?.inWave ?? false,
    avatar: state?.avatar ?? null,
    name: state?.name ?? null,
    /** False until we have any answer at all — callers that must not guess wait on this. */
    ready: state !== null,
    setLook,
    saveAvatar,
  };
}
