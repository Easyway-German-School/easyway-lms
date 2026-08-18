"use client";

import Link from "next/link";
import { useEffect, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, CheckCircleIcon, CheckIcon } from "@/components/icons";

function LessonContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lessonId = searchParams.get("id");

  const [lesson, setLesson] = useState<any>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [personalizedPlan, setPersonalizedPlan] = useState<any>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated" && lessonId) {
      loadLesson();
    }
  }, [status, lessonId]);

  const loadLesson = async () => {
    try {
      const res = await fetch(`/api/lesson?lessonId=${lessonId}`);
      const data = await res.json();
      setLesson(data.lesson);
      setCompletion(data.completion);
    } catch (error) {
      console.error("Failed to load lesson:", error);
    }
  };

  const handleComplete = async () => {
    if (!lessonId) return;
    setIsCompleting(true);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId,
          score: lesson?.type === "quiz" ? 95 : null,
          feedback: "Great work!"
        })
      });
      const data = await res.json();
      if (data?.plan) {
        setPersonalizedPlan(data.plan);
        localStorage.setItem("studentPersonalizedPlan", JSON.stringify(data.plan));
      }
      setCompletion({ status: "completed", completedAt: new Date() });
    } catch (error) {
      console.error("Failed to complete lesson:", error);
    } finally {
      setIsCompleting(false);
    }
  };

  if (status === "loading" || !lesson) {
    return (
      <div className="min-h-screen bg-[var(--surface-alt)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
          <p className="text-[var(--muted)]">Loading lesson...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface-alt)] py-10">
      <div className="mx-auto max-w-4xl px-6 md:px-10 space-y-8">
        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-emerald-700 p-8 text-white shadow-sm">
          <div className="mb-4">
            <Link href="/dashboard" className="inline-flex items-center gap-2 text-emerald-100 hover:text-white text-sm font-semibold">
              <ArrowLeftIcon /> Back to dashboard
            </Link>
          </div>
          <h1 className="text-4xl font-bold">{lesson.title}</h1>
          <p className="mt-2 text-slate-200">{lesson.description}</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-100">
            <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1">{lesson.type}</span>
            <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1">{lesson.duration} mins</span>
            <span className="rounded-full bg-amber-400/20 px-3 py-1 font-semibold text-amber-100">Reward: +{Math.max(25, lesson.duration)} XP</span>
            {completion?.status === "completed" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/25 px-3 py-1 text-emerald-100"><CheckIcon className="h-3.5 w-3.5" /> Completed</span>
            )}
          </div>
        </header>

        <div className="rounded-3xl border border-emerald-200 bg-emerald-500/10 p-5 text-emerald-800 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em]">Quest mission</p>
          <p className="mt-2 text-lg font-semibold">Complete this lesson to unlock your next power-up and keep the streak alive.</p>
        </div>

        {/* Content */}
        <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm space-y-6">
          <div className="prose prose-sm max-w-none">
            <div className="text-[var(--foreground-soft)] leading-relaxed whitespace-pre-wrap">{lesson.content}</div>
            {lesson.content?.includes('![](') || lesson.content?.includes('<video') ? (
              <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--foreground)]">Attached media</p>
                <div className="mt-3 space-y-3">
                  {lesson.content.match(/!\[.*?\]\((.*?)\)/g)?.map((item: string, idx: number) => {
                    const url = item.match(/\((.*?)\)/)?.[1];
                    return <img key={idx} src={url} alt="Lesson media" className="w-full rounded-xl object-cover" />;
                  })}
                  {lesson.content.includes('<video') ? (
                    <video controls className="w-full rounded-xl">
                      <source src={lesson.content.match(/src="(.*?)"/)?.[1]} />
                    </video>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Action */}
        {!completion?.completedAt && (
          <div className="rounded-3xl bg-emerald-500/10 p-8 shadow-sm space-y-4">
            <h3 className="text-xl font-semibold text-[var(--foreground)]">
              {lesson?.type === "assignment" ? "Submit Assignment" : "Complete this lesson"}
            </h3>
            {lesson?.type === "assignment" ? (
              <Link
                href={`/assignment?lessonId=${lessonId}`}
                className="block w-full py-3 bg-emerald-500 text-white font-semibold rounded-xl hover:bg-emerald-600 text-center"
              >
                Open Assignment Submission
              </Link>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isCompleting}
                className="w-full py-3 bg-emerald-500 text-white font-semibold rounded-xl hover:bg-emerald-600 disabled:opacity-60"
              >
                {isCompleting ? "Claiming reward..." : `Claim +${Math.max(25, lesson.duration)} XP`}
              </button>
            )}
          </div>
        )}

        {completion?.completedAt && (
          <div className="rounded-3xl bg-emerald-500/10 p-8 shadow-sm border border-emerald-200">
            <p className="flex items-center gap-2 text-[var(--success)] font-semibold"><CheckCircleIcon className="h-5 w-5" /> You&apos;ve completed this lesson!</p>
            <p className="text-sm text-emerald-600 mt-2">Great progress. Move on to the next lesson.</p>
            {personalizedPlan ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-[var(--surface)] p-4">
                <p className="text-sm font-semibold text-emerald-800">Personalized plan refreshed</p>
                <p className="mt-1 text-sm text-[var(--success)]">{(personalizedPlan.lessons || []).length} recommended next steps are ready.</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LessonPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-alt)] flex items-center justify-center"><p>Loading...</p></div>}>
      <LessonContent />
    </Suspense>
  );
}
