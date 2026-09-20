"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import TutorialOverlay from "@/components/TutorialOverlay";
import { CrossIcon, PlayIcon } from "@/components/icons";
import { setMomentPreempted } from "@/lib/moment-queue";
import {
  buildTutorials,
  buildWelcomeTutorial,
  clearTutorialRun,
  onTutorialRunChanged,
  readTutorialRun,
  writeTutorialRun,
  type TutorialRunState,
} from "@/lib/tutorials";
import { markTutorialCompleted } from "@/lib/tutorial-progress";
import { speak, stopSpeaking } from "@/lib/tutorial-speech";
import { useOnboardingProfile } from "@/lib/use-onboarding";
import { useStudentAccess } from "@/lib/useStudentAccess";

/**
 * The one place a replayable tutorial actually plays.
 *
 * Mounted once, unconditionally, in StudentShellBody — every student page
 * renders through there, so it's the seam a tutorial's progress can survive
 * a real `router.push` between steps (see the sessionStorage run state in
 * lib/tutorials.ts; React state does not survive that navigation, because
 * StudentShell itself remounts on every page change).
 *
 * Deliberately NOT gated through the moment queue: a tutorial is student-
 * initiated and repeatable (reached by visiting /tutorials), not a one-time
 * "did they see this yet" interruption competing for a turn. The one
 * exception is the `welcome` run, which claims and instantly releases the
 * queue's "welcome-tour" slot (see WelcomeTutorialLauncher) because the
 * queue can't hold a turn across the page navigations a tutorial makes.
 * That release used to leave a gap: a lower-priority popup (the cohort-check
 * ask, the goal question) could open behind the tour's own steps the moment
 * that slot was free, which is how a new student could meet two interruptions
 * stacked on their first visit. So while any step is genuinely on screen this
 * preempts the queue directly instead (see MOMENT_PREEMPT_EVENT) — a tutorial
 * still isn't a queue entry, but nothing else gets to show while one is up.
 */
export default function TutorialRuntime() {
  const pathname = usePathname();
  const router = useRouter();
  const { access } = useStudentAccess();

  const [run, setRun] = useState<TutorialRunState | null>(() => readTutorialRun());
  useEffect(() => onTutorialRunChanged(() => setRun(readTutorialRun())), []);

  // The `welcome` tutorial (WelcomeTour's replacement) needs the full
  // onboarding profile to personalise itself; every other tutorial only
  // needs the lighter access hint. Fetched only when actually in a `welcome`
  // run, so the extra request never happens for the other six.
  const isWelcomeRun = run?.tutorialId === "welcome";
  const onboardingQuery = useOnboardingProfile(isWelcomeRun);

  const libraryTutorials = buildTutorials({ deliveryMode: access?.deliveryMode, classType: access?.classType });
  const tutorial = !run
    ? null
    : isWelcomeRun
      ? onboardingQuery.data
        ? buildWelcomeTutorial(onboardingQuery.data)
        : null
      : libraryTutorials.find((t) => t.id === run.tutorialId) ?? null;
  const step = run && tutorial ? tutorial.steps[run.stepIndex] : undefined;

  // A run pointing at a tutorial or step that no longer exists (content
  // changed under it, or a corrupt value) is worth less than nothing — but a
  // `welcome` run legitimately has no tutorial yet while its profile fetch is
  // still in flight, so don't judge it until that settles.
  useEffect(() => {
    if (!run) return;
    if (isWelcomeRun && onboardingQuery.isPending) return;
    if (!tutorial || !step) clearTutorialRun();
  }, [run, tutorial, step, isWelcomeRun, onboardingQuery.isPending]);

  const active = Boolean(run && tutorial && step && run.expectedRoute === pathname);

  // A step is only "shown" once its overlay has actually drawn (see
  // TutorialOverlay: it waits for the target). Narration waits for that too, so
  // Becca never starts talking over a page that is still showing its loader.
  // Keyed by step id, so a new step is un-shown again automatically.
  const [shownStepId, setShownStepId] = useState<string | null>(null);
  const shown = Boolean(step && shownStepId === step.id);
  const handleShown = useCallback((id: string) => setShownStepId(id), []);

  /**
   * A `welcome` run is known synchronously (sessionStorage) on the very first
   * render, but `tutorial` for it stays null until the onboarding fetch
   * resolves — same shape of race as PhotoUnlockGuide's `maybeNeedsScreen`
   * (see that module's comment): a queue-managed popup could take a turn in
   * that gap and be caught mid-transition once this preempts a beat later.
   * Held only while a run genuinely matches the current route, so an
   * unrelated stale run elsewhere can't hold the queue hostage.
   */
  const pendingOnRoute = Boolean(run && !active && run.expectedRoute === pathname);

  // See the module comment: stand the queue down for exactly as long as a
  // step is genuinely rendered, or might be about to be, so nothing else can
  // open mid-walkthrough.
  useEffect(() => {
    const dispatch = (wantsActive: boolean) => {
      setMomentPreempted("tutorial", wantsActive);
    };
    dispatch(active || pendingOnRoute);
    return () => dispatch(false);
  }, [active, pendingOnRoute]);

  // The one path out, however it happens — the last step's "Done", or the
  // Exit/Escape button on any earlier step. Both count as "seen": WelcomeTour
  // always treated skipping the same as finishing, since a student who
  // dismissed onboarding should not be walked through it again either.
  const finishTutorial = useCallback(() => {
    stopSpeaking();
    setMomentPreempted("tutorial", false);
    if (tutorial) {
      tutorial.onFinish?.();
      markTutorialCompleted(tutorial.id);
    }
    clearTutorialRun();
    window.dispatchEvent(new CustomEvent("easyway:tour-drawer", { detail: { open: false } }));
  }, [tutorial]);

  const handleExit = useCallback(() => {
    finishTutorial();
  }, [finishTutorial]);

  const handleNext = useCallback(() => {
    if (!run || !tutorial) return;
    stopSpeaking();
    const nextIndex = run.stepIndex + 1;
    if (nextIndex >= tutorial.steps.length) {
      finishTutorial();
      return;
    }
    const nextStep = tutorial.steps[nextIndex];
    const nextRoute = nextStep.route ?? pathname;
    writeTutorialRun({ tutorialId: run.tutorialId, stepIndex: nextIndex, muted: run.muted, expectedRoute: nextRoute });
    if (nextRoute !== pathname) router.push(nextRoute);
  }, [run, tutorial, pathname, router, finishTutorial]);

  const handleBack = useCallback(() => {
    if (!run || !tutorial || run.stepIndex === 0) return;
    stopSpeaking();
    const prevIndex = run.stepIndex - 1;
    const prevStep = tutorial.steps[prevIndex];
    const prevRoute = prevStep.route ?? pathname;
    writeTutorialRun({ tutorialId: run.tutorialId, stepIndex: prevIndex, muted: run.muted, expectedRoute: prevRoute });
    if (prevRoute !== pathname) router.push(prevRoute);
  }, [run, tutorial, pathname, router]);

  const handleToggleMute = useCallback(() => {
    if (!run) return;
    if (!run.muted) stopSpeaking();
    writeTutorialRun({ ...run, muted: !run.muted });
  }, [run]);

  const handleResume = useCallback(() => {
    if (!run) return;
    router.push(run.expectedRoute);
  }, [run, router]);

  // The sidebar is a drawer on a phone — ask the shell to open it for a step
  // whose target lives inside it, the same way WelcomeTour already does.
  //
  // Deferred a tick rather than dispatched synchronously: on a step that just
  // navigated to a new page, StudentShellBody's own "close the drawer on
  // pathname change" effect fires in the same commit — as the parent, its
  // passive effect runs AFTER this component's (a child's), so a synchronous
  // dispatch here would open the drawer only for that reset to immediately
  // close it again. A macrotask delay lands after that effect has settled.
  useEffect(() => {
    if (!active || !step) return;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("easyway:tour-drawer", { detail: { open: Boolean(step.inSidebar) } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);

  // Narration. A step NEVER moves on by itself — the student taps Next when
  // they are ready. Reading at their own pace matters more than a hands-free
  // demo, and a tour that navigates away mid-sentence (or mid-read, for
  // someone slower to read or new to phones) is a tour they abandon. Only a
  // step that explicitly sets `autoAdvance: true` advances after narration.
  // `handleNext` is read through a ref so a fresh timer isn't created every
  // time it's redefined.
  const handleNextRef = useRef(handleNext);
  handleNextRef.current = handleNext;
  useEffect(() => {
    if (!active || !step || !shown) return;
    let cancelled = false;
    let timer: number | null = null;

    const scheduleAdvance = (delay: number) => {
      if (step.autoAdvance !== true) return;
      timer = window.setTimeout(() => {
        if (!cancelled) handleNextRef.current();
      }, delay);
    };

    if (run?.muted) {
      scheduleAdvance(step.autoAdvanceMs ?? 4500);
    } else {
      const started = speak(step.narration, {
        onEnd: () => scheduleAdvance(900),
        onError: () => scheduleAdvance(step.autoAdvanceMs ?? 4500),
      });
      if (!started) scheduleAdvance(step.autoAdvanceMs ?? 4500);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, step?.id, step?.narration, step?.autoAdvance, step?.autoAdvanceMs, run?.muted]);

  // Warm the next page while the student reads this one. A step that carries
  // them to another route then lands at once instead of suspending on the
  // route-level loader — which is what made the loader flash mid-tour.
  useEffect(() => {
    if (!active || !run || !tutorial) return;
    const upcoming = tutorial.steps[run.stepIndex + 1]?.route;
    if (upcoming && upcoming !== pathname) router.prefetch(upcoming);
  }, [active, run, tutorial, pathname, router]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleExit();
      if (event.key === "ArrowRight") handleNext();
      if (event.key === "ArrowLeft") handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, handleExit, handleNext, handleBack]);

  if (!run || !tutorial || !step) return null;

  if (!active) {
    return (
      <div className="fixed bottom-20 left-4 z-[110] sm:bottom-6">
        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-2 pl-3 pr-2 shadow-xl">
          <button
            type="button"
            onClick={handleResume}
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
          >
            <PlayIcon className="h-4 w-4" />
            Resume {tutorial.title}
          </button>
          <button
            type="button"
            onClick={handleExit}
            aria-label="Dismiss tutorial"
            className="rounded-full p-1 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            <CrossIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <TutorialOverlay
      step={step}
      stepNumber={run.stepIndex + 1}
      totalSteps={tutorial.steps.length}
      muted={run.muted}
      hasBack={run.stepIndex > 0}
      isLast={run.stepIndex === tutorial.steps.length - 1}
      onNext={handleNext}
      onBack={handleBack}
      onExit={handleExit}
      onToggleMute={handleToggleMute}
      onShown={handleShown}
    />
  );
}
