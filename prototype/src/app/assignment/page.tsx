"use client";

import Link from "next/link";
import { useEffect, useState, Suspense, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import StudentShell from "@/components/StudentShell";
import StudentAccessGate from "@/components/StudentAccessGate";
import AssignmentsPanel from "@/components/AssignmentsPanel";

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
  const [paymentReady, setPaymentReady] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/student", { credentials: "include" });
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          const hasAccess = Boolean(data?.paymentSummary?.depositPaid || data?.paymentSummary?.fullPaid);
          setPaymentReady(hasAccess);
        }
      } catch {
        // ignore
      } finally {
        if (active) setPaymentLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

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
    if (!submission.trim() && !file) {
      alert("Please enter text or upload a file");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("lessonId", lessonId || "");
      formData.append("submission", submission);
      if (file) {
        formData.append("file", file);
      }

      const res = await fetch("/api/assignment/submit", {
        method: "POST",
        body: formData
      });

      if (res.ok) {
        setSubmitted(true);
        setSubmission("");
        setFile(null);
        alert("Assignment submitted successfully!");
      }
    } catch (error) {
      console.error("Submission error:", error);
      alert("Failed to submit assignment");
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
        <StudentAccessGate hasAccess={paymentReady} loading={paymentLoading}>
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
        </StudentAccessGate>
      </StudentShell>
    );
  }

  if (status === "loading" || !lesson) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto"></div>
          <p className="text-slate-600">Loading assignment...</p>
        </div>
      </div>
    );
  }

  return (
    <StudentShell>
      <StudentAccessGate hasAccess={paymentReady} loading={paymentLoading}>
        <div className="min-h-screen bg-slate-50 py-10">
          <div className="mx-auto max-w-4xl px-6 md:px-10 space-y-8">
            <header className="rounded-3xl bg-white p-8 shadow-sm">
              <div className="mb-4">
                <Link href="/dashboard" className="text-emerald-500 hover:text-emerald-600 text-sm font-semibold">
                  ← Back to dashboard
                </Link>
              </div>
              <h1 className="text-4xl font-bold text-slate-950">Submit Assignment</h1>
              <p className="text-slate-600 mt-2">{lesson.title}</p>
            </header>

            <div className="rounded-3xl bg-white p-8 shadow-sm space-y-6">
              <h2 className="text-2xl font-bold text-slate-950">Instructions</h2>
              <div className="prose prose-sm max-w-none">
                <p className="text-slate-700 whitespace-pre-wrap">{lesson.content}</p>
              </div>
            </div>

            {!submitted ? (
              <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-8 shadow-sm space-y-6">
                <h2 className="text-2xl font-bold text-slate-950">Your Submission</h2>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-950 mb-2">Write your response</label>
                  <textarea
                    value={submission}
                    onChange={(e) => setSubmission(e.target.value)}
                    placeholder="Type your answer or essay here..."
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500 resize-none h-40"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-950 mb-2">Or upload a file</label>
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-emerald-500 transition">
                    <input
                      type="file"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="file-input"
                      accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                    />
                    <label htmlFor="file-input" className="cursor-pointer">
                      <p className="text-slate-600 font-semibold">
                        {file ? file.name : "Click to upload file"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">PDF, DOC, DOCX, TXT, PNG, JPG</p>
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-60"
                >
                  {isSubmitting ? "Submitting..." : "Submit Assignment"}
                </button>
              </form>
            ) : (
              <div className="rounded-3xl bg-emerald-50 p-8 shadow-sm border border-emerald-200 space-y-4">
                <p className="text-2xl font-bold text-emerald-700">✓ Assignment submitted!</p>
                <p className="text-emerald-600">Your work has been received. The instructor will review and provide feedback soon.</p>
                <Link href="/dashboard" className="inline-block px-6 py-2 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600">
                  Back to dashboard
                </Link>
              </div>
            )}
          </div>
        </div>
      </StudentAccessGate>
    </StudentShell>
  );
}

export default function AssignmentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><p>Loading...</p></div>}>
      <AssignmentContent />
    </Suspense>
  );
}
