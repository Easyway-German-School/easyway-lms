"use client";

import { useQuery } from "@tanstack/react-query";
import type { OnboardingProfile } from "@/lib/tutorials";

export const onboardingQueryKey = ["student", "onboarding"] as const;

/**
 * What the welcome tutorial (and the launcher deciding whether to start it)
 * needs to know about this student. Shaped like `useStudentAccess` — cached
 * across navigation via react-query, since StudentShell remounts on every
 * page change.
 *
 * `enabled` is a real react-query option, not just a guard: pass `false` when
 * nothing on the current render needs this (the common case — only the
 * `welcome` tutorial and its launcher ever do), so most pages never fetch it
 * at all.
 */
export function useOnboardingProfile(enabled: boolean) {
  return useQuery<OnboardingProfile>({
    queryKey: onboardingQueryKey,
    queryFn: async () => {
      const response = await fetch("/api/student/onboarding", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read onboarding state");
      return response.json();
    },
    enabled,
    staleTime: 60_000,
  });
}
