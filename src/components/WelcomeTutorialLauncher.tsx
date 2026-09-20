"use client";

import { useEffect } from "react";
import { setMomentPreempted, useMoment } from "@/lib/moment-queue";
import { useOnboardingProfile } from "@/lib/use-onboarding";
import { writeTutorialRun } from "@/lib/tutorials";

/**
 * Replaces WelcomeTour.tsx. Decides WHEN a brand-new student's onboarding
 * walkthrough should start — claiming the same `"welcome-tour"` moment-queue
 * slot at the same priority, so it still respects the existing interruption
 * ordering (behind the payment-success toast, ahead of everything else).
 *
 * Once granted, it just writes the `welcome` tutorial's run state and hands
 * the turn straight back: the actual multi-page walkthrough that follows is
 * unqueued from there, exactly like every other tutorial — a moment-queue
 * turn cannot outlive the page it was granted on anyway, since navigating
 * remounts the whole queue along with everything else in StudentShell.
 *
 * Renders nothing itself; TutorialRuntime (mounted in StudentShell) does all
 * the actual showing.
 */
export default function WelcomeTutorialLauncher() {
  const { data: onboarding, isSuccess } = useOnboardingProfile(true);
  const due = Boolean(isSuccess && onboarding && !onboarding.tourSeen);
  const { open, close } = useMoment("welcome-tour", due);

  useEffect(() => {
    if (!open) return;
    setMomentPreempted("tutorial", true);
    writeTutorialRun({ tutorialId: "welcome", stepIndex: 0, muted: false, expectedRoute: "/dashboard" });
    close();
  }, [open, close]);

  return null;
}
