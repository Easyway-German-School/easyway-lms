"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { StudentAccess } from "@/lib/access";
import type { PortalVerdict } from "@/lib/portal-verdict";

export const studentAccessQueryKey = ["student", "access"] as const;

/**
 * Whether this student may see class content yet.
 *
 * Goes through react-query because StudentShell remounts on every client
 * navigation — without a shared cache the portal would re-ask on each page
 * change and flash the lock screen at students who have in fact paid.
 */
export function useStudentAccess() {
  const query = useQuery<StudentAccess & { hasPhoto: boolean; privateClassPrice?: number; verdict?: PortalVerdict; computedAt?: number }>({
    queryKey: studentAccessQueryKey,
    queryFn: async () => {
      const response = await fetch("/api/student/access", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read access state");
      return response.json();
    },
    staleTime: 60_000,
    /**
     * While a student is locked, keep asking. A student staring at a lock screen
     * has no other way to learn that an admin just unlocked them, or that their
     * payment just cleared, short of reloading — which reads as "I paid and it is
     * still locked". Only locked students poll, only in a visible tab (react-query
     * pauses background intervals), and the answer is ~1KB.
     */
    refetchInterval: (q) => {
      const data = q.state.data;
      // Not for an upcoming-intake wait: nothing changes for them until the start date.
      const payLocked = data?.hasAccess === false && data.lockReason !== "upcoming_batch";
      return data && (payLocked || data.hasPhoto === false) ? 30_000 : false;
    },
  });

  return {
    access: query.data ?? null,
    /**
     * Unknown state counts as "no decision yet", never as "locked" — a student
     * who has paid must not see a padlock while their status is in flight.
     */
    hasAccess: query.data?.hasAccess ?? true,
    loading: query.isPending,
    failed: query.isError,
  };
}

/** Call after a payment lands so the portal unlocks without a full reload. */
export function useRefreshStudentAccess() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: studentAccessQueryKey });
}
