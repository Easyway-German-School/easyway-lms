"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Mascot from "@/components/Mascot";
import StudentShell from "@/components/StudentShell";
import { CheckCircleIcon, ClockIcon, PlayIcon } from "@/components/icons";
import { buildTutorials, writeTutorialRun, type Tutorial } from "@/lib/tutorials";
import { getCompletedTutorialIds } from "@/lib/tutorial-progress";
import { unlockSpeechSynthesis } from "@/lib/tutorial-speech";
import { setMomentPreempted } from "@/lib/moment-queue";
import { useStudentAccess } from "@/lib/useStudentAccess";

/**
 * The library of Becca's narrated walkthroughs — replayable any time, unlike
 * the once-per-account WelcomeTour. See TutorialRuntime for how a tutorial
 * actually plays across pages once "Start" is tapped here.
 */
export default function TutorialsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { access } = useStudentAccess();
  const [completed, setCompleted] = useState<string[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  useEffect(() => {
    setCompleted(getCompletedTutorialIds());
  }, []);

  const tutorials = useMemo(
    () => buildTutorials({ deliveryMode: access?.deliveryMode, classType: access?.classType }),
    [access?.deliveryMode, access?.classType],
  );

  const start = (tutorial: Tutorial) => {
    // Synchronously inside the click, so the browser's gesture-unlock for
    // speechSynthesis is granted before any navigation — it then survives
    // the client-side route change that follows, on browsers (iOS Safari)
    // that otherwise require speech to originate from a user gesture.
    unlockSpeechSynthesis();
    setMomentPreempted("tutorial", true);
    const first = tutorial.steps[0];
    const expectedRoute = first.route ?? "/tutorials";
    writeTutorialRun({ tutorialId: tutorial.id, stepIndex: 0, muted: false, expectedRoute });
    if (expectedRoute !== "/tutorials") router.push(expectedRoute);
  };

  return (
    <StudentShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-4">
          <Mascot mood="presenting" className="h-16 w-16 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Tutorials</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Becca walks you through the portal, feature by feature — rewatch any of these whenever you like.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {tutorials.map((tutorial) => {
            const watched = completed.includes(tutorial.id);
            return (
              <div
                key={tutorial.id}
                className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-[var(--foreground)]">{tutorial.title}</h2>
                  {watched && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                      <CheckCircleIcon className="h-3 w-3" /> Watched
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[var(--muted)]">{tutorial.blurb}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <ClockIcon className="h-3.5 w-3.5" /> {tutorial.estMinutes} min
                  </span>
                  <button
                    type="button"
                    onClick={() => start(tutorial)}
                    className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-110"
                  >
                    <PlayIcon className="h-4 w-4" />
                    {watched ? "Rewatch" : "Start"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </StudentShell>
  );
}
