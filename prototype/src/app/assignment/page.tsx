"use client";

import Link from "next/link";
import { useEffect, useState, Suspense, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import StudentShell from "@/components/StudentShell";
import AssignmentsPanel from "@/components/AssignmentsPanel";
import BrandLoader from "@/components/BrandLoader";
import { uploadFile } from "@/lib/upload";
import { ArrowLeftIcon, CheckCircleIcon } from "@/components/icons";

function AssignmentContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lessonId = searchParams.get("lessonId");

  const [lesson, setLesson] = useState<{ title: string; content: string } | null>(null);
  const [submission, setSubmission] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** Replaces three `alert()` calls — a browser dialog is not a submission receipt. */
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  const loadLesson = useCallback(async () => {
    if (!lessonId) return;

    try {
      const res = await fetch(`/api/lesson?lessonId=${lessonId}`);
      const data = await res.json();
      setLesson(data.lesson);
    } catch (error) {
      console.error("Failed to load lesson:", error);
    }
  }, [lessonId]);

  useEffect(() => {
    if (status === "authenticated" && lessonId) {
      const timer = window.setTimeout(() => {
        void loadLesson();
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [status, lessonId, loadLesson]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);

    if (!submission.trim() && !file) {
      setNotice({ tone: "error", text: "Write your answer or attach a file first." });
      return;
    }

    setIsSubmitting(true);
    try {
      /**
       * THE FILE GOES TO THE BUCKET FIRST.
       *
       * It used to be posted to /api/assignment/submit as multipart, and that
       * route recorded the filename and discarded the bytes — the student was
       * told their homework had arrived and the tutor had nothing to open.
       * Uploading here, through the same presigned path the rest of the app
       * uses, is what makes the submission real; it also keeps a scanned page
       * off Vercel's 4.5 MB request-body limit.
       */
      let fileUrl: string | null = null;
      let fileName: string | null = null;
      if (file) {
        const uploaded = await uploadFile(file, "files");
        fileUrl = uploaded.url;
        fileName = uploaded.filename;
      }

      const res = await fetch("/api/assignment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lessonId || "", submission, fileUrl, fileName }),
      });

      const data = await res.json().catch(() => ({}));
      // The old version only acted on success and said nothing at all on a
      // failure, so a rejected submission looked exactly like a slow one.
      if (!res.ok) throw new Error(data.error || "Your work was not submitted.");

      setSubmitted(true);
      setSubmission("");
      setFile(null);
      setNotice({ tone: "success", text: "Handed in. Your tutor will mark it and you will be told when it is back." });
    } catch (error) {
      console.error("Submission error:", error);
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Your work was not submitted. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // No lessonId means the student came from the sidebar rather than from a
  // specific lesson, so show everything set for their level. Without this the
  // page waited forever for a lesson that was never going to load.
  if (!lessonId) {
    return (
      <StudentShell>
        <div className="px-6 py-8">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Your work</p>
            <h1 className="mt-2 text-3xl font-bold">Assignments</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Documents to hand in and timed quizzes set by your tutor.
            </p>
          </div>
          <AssignmentsPanel />
        </div>
      </StudentShell>
    );
  }

  if (status === "loading" || !lesson) {
    return (
      <div className="min-h-screen bg-[var(--surface-alt)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
          <p className="text-[var(--muted)]">Loading assignment...</p>
        </div>
      </div>
    );
  }

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--surface-alt)] py-10">
        <div className="mx-auto max-w-4xl px-6 md:px-10 space-y-8">
          <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
            <div className="mb-4">
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-emerald-500 hover:text-emerald-600 text-sm font-semibold">
                <ArrowLeftIcon /> Back to dashboard
              </Link>
            </div>
            <h1 className="text-4xl font-bold text-slate-950">Submit Assignment</h1>
            <p className="text-[var(--muted)] mt-2">{lesson.title}</p>
          </header>

          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm space-y-6">
            <h2 className="text-2xl font-bold text-slate-950">Instructions</h2>
            <div className="prose prose-sm max-w-none">
              <p className="text-[var(--foreground-soft)] whitespace-pre-wrap">{lesson.content}</p>
            </div>
          </div>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="rounded-3xl bg-[var(--surface)] p-8 shadow-sm space-y-6">
              <h2 className="text-2xl font-bold text-slate-950">Your Submission</h2>
              
              <div>
                <label className="block text-sm font-semibold text-slate-950 mb-2">Write your response</label>
                <textarea
                  value={submission}
                  onChange={(e) => setSubmission(e.target.value)}
                  placeholder="Type your answer or essay here..."
                  className="w-full px-4 py-3 border border-[var(--border)] rounded-lg focus:outline-none focus:border-emerald-500 resize-none h-40"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-950 mb-2">Or upload a file</label>
                <div className="border-2 border-dashed border-[var(--border-strong)] rounded-lg p-6 text-center hover:border-emerald-500 transition">
                  <input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-input"
                    /*
                      Narrowed to what the upload path will actually accept.
                      `.doc` and `.txt` were offered here and are not in the
                      presign allow-list, so choosing one failed at the end of
                      the wait — after the student believed they had handed in.
                    */
                    accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic"
                  />
                  <label htmlFor="file-input" className="cursor-pointer">
                    <p className="text-[var(--muted)] font-semibold">
                      {file ? file.name : "Click to upload file"}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-1">PDF, DOCX, or a photo of your work</p>
                  </label>
                </div>
              </div>

              {notice ? (
                <p
                  className={`rounded-xl px-4 py-3 text-sm ${
                    notice.tone === "success"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-rose-500/10 text-rose-700"
                  }`}
                >
                  {notice.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-60"
              >
                {isSubmitting ? "Handing in…" : "Submit Assignment"}
              </button>
            </form>
          ) : (
            <div className="rounded-3xl bg-emerald-500/10 p-8 shadow-sm border border-emerald-200 space-y-4">
              <p className="flex items-center gap-2 text-2xl font-bold text-[var(--success)]"><CheckCircleIcon className="h-7 w-7" /> Assignment submitted!</p>
              <p className="text-emerald-600">Your work has been received. The instructor will review and provide feedback soon.</p>
              <Link href="/dashboard" className="inline-block px-6 py-2 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600">
                Back to dashboard
              </Link>
            </div>
          )}
        </div>
      </div>
    </StudentShell>
  );
}

export default function AssignmentPage() {
  return (
    <Suspense fallback={<BrandLoader fill size="lg" />}>
      <AssignmentContent />
    </Suspense>
  );
}
