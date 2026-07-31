"use client";

import { motion } from "framer-motion";
import { useState } from "react";

interface FeedbackItem {
  category: string;
  comment: string;
  score: number;
}

import StudentShell from "@/components/StudentShell";
import { TargetIcon } from "@/components/icons";

export default function EssayGrader() {
  const [essay, setEssay] = useState(
    "Ich möchte meine Deutschkenntnisse verbessern und ein Goethe-Zertifikat erreichen. Das Goethe-Institut ist eine der besten Optionen, um ein international anerkanntes Zertifikat zu bekommen."
  );
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [summary, setSummary] = useState("Write your essay and click the challenge button to receive AI feedback.");
  const [score, setScore] = useState<number | null>(null);
  const [nextStep, setNextStep] = useState<string>("");
  const [isGrading, setIsGrading] = useState(false);

  async function handleGrade() {
    if (!essay.trim()) return;
    setIsGrading(true);
    setSummary("Analyzing your essay with the AI coach...");
    setFeedback([]);
    setNextStep("");

    try {
      const response = await fetch("/api/ai/grade-essay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ essay }),
      });

      if (!response.ok) {
        setSummary("Unable to reach the essay grader API.");
        return;
      }

      const json = await response.json();
      setScore(json.score);
      setSummary(json.summary);
      setFeedback(json.feedback || []);
      setNextStep(json.nextStep || "Focus on the weakest category and practice targeted exercises.");
    } catch (error) {
      console.error(error);
      setSummary("Unable to reach the essay grader API.");
    } finally {
      setIsGrading(false);
    }
  }

  return (
    <StudentShell>
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: "easeOut" }}
        className="min-h-screen bg-[var(--surface-alt)] py-10 text-[var(--foreground)]"
      >
      <div className="mx-auto max-w-5xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-700 p-8 text-white shadow-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-200">Goethe challenge lab</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Essay mastery quest</h1>
          <p className="mt-4 max-w-2xl text-slate-200">Submit your writing, unlock feedback, and turn every essay into a level-up moment.</p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
          <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-2xl transition-transform duration-300 hover:-translate-y-1 ring-1 ring-white/10">
            <textarea value={essay} onChange={(event) => setEssay(event.target.value)} rows={16} className="w-full rounded-3xl border border-[rgba(148,163,184,0.25)] bg-[var(--surface-alt)] p-5 text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(16,185,129,0.18)]" />
            <button onClick={handleGrade} disabled={isGrading} className="mt-6 inline-flex items-center justify-center rounded-full bg-[var(--foreground)] px-6 py-3 text-sm font-semibold text-[var(--surface)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
              {isGrading ? "Grading..." : "Start challenge +50 XP"}
            </button>
          </div>

          <aside className="space-y-5 rounded-3xl bg-gradient-to-b from-slate-950 to-slate-800 p-6 text-slate-50 shadow-2xl ring-1 ring-white/10">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Mission rules</p>
              <h2 className="mt-3 text-2xl font-semibold">What this quest rewards</h2>
            </div>
            <ul className="space-y-3 text-sm leading-7 text-slate-300">
              <li>• Grammar and sentence structure</li>
              <li>• Vocabulary precision and register</li>
              <li>• Task completion and cohesion</li>
              <li>• Spelling, connectors, and confidence</li>
            </ul>
            <div className="rounded-3xl bg-white/10 p-4 text-sm text-slate-200">Every submission gives you feedback, a score, and a clear next-step objective.</div>
          </aside>
        </section>

        <section className="rounded-3xl bg-[var(--surface)] p-6 shadow-2xl transition-transform duration-300 hover:-translate-y-1 ring-1 ring-white/10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-[var(--foreground)]">AI feedback</h2>
            {score !== null && <div className="text-3xl font-bold text-[var(--accent)]">{score}/100</div>}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl bg-[var(--surface-alt)] p-5 text-[var(--foreground)] transition border border-[rgba(148,163,184,0.25)] hover:border-[var(--accent)]">
              <p className="text-sm leading-6">{summary}</p>
            </div>

            {score !== null && (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-[var(--success)]">
                <p className="flex items-center gap-2 font-semibold"><TargetIcon /> Suggested next step</p>
                <p className="mt-1">{nextStep || "Focus on the weakest category and practice targeted exercises."}</p>
              </div>
            )}

            {feedback.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                {feedback.map((item: FeedbackItem, index) => (
                  <div key={`${item.category}-${index}`} className="rounded-2xl border border-[rgba(148,163,184,0.25)] p-4 hover:border-[var(--accent)]">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold text-[var(--foreground)]">{item.category}</h3>
                      <span className="text-sm font-bold text-[var(--accent)]">{item.score}/100</span>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{item.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  </StudentShell>
  );
}
