"use client";

import { useQuery } from "@tanstack/react-query";

import type { Badge, GamificationSummary } from "@/lib/gamification";

export type GamificationPayload = GamificationSummary & {
  streak: number;
  stats: {
    sessionsAttended: number;
    totalSessions: number;
    attendanceRate: number | null;
    submissions: number;
    completedLessons: number;
    averageGrade: number | null;
    examsRegistered: number;
    missionsCompleted: number;
    examReadiness: number;
    memberSince: string;
  };
  badges: Badge[];
  badgesEarned: number;
};

/** Shared by the dashboard and the profile so both show the same level. */
export function useGamification() {
  const query = useQuery<GamificationPayload>({
    queryKey: ["student", "gamification"],
    queryFn: async () => {
      const response = await fetch("/api/student/gamification", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load progress");
      return response.json();
    },
    staleTime: 60_000,
  });

  return { game: query.data ?? null, loading: query.isPending };
}
