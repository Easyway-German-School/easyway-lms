"use client";

/**
 * Pronunciation practice and the personalized study plan — moved here from the
 * dashboard.
 *
 * They used to be the single biggest block on the dashboard: one card, always
 * fully expanded, sitting above the fold on a phone before a student had even
 * reached their own progress. Nothing else on that page competes for attention
 * the way "type something and wait for AI feedback" does, and the dashboard's
 * job is a five-second glance at where you stand, not a workspace. This is a
 * tool a student opens when they mean to use it — which is what the Games tab
 * next to it already is — so it moved in next to it rather than living
 * somewhere that has to stay quiet the rest of the time.
 */

import { useState } from "react";

export default function AICoachPanel() {
  const [aiTab, setAiTab] = useState<"pronunciation" | "plan">("pronunciation");
  const [plannerStrategy, setPlannerStrategy] = useState("hybrid");
  const [phrase, setPhrase] = useState("Ich möchte ein Visum beantragen.");
  const [feedback, setFeedback] = useState<string[]>(["Type a phrase and press Analyze."]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [personalizedPlan, setPersonalizedPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);

  async function handleAnalyze() {
    if (!phrase.trim()) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze-pronunciation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      const data = await res.json();
      const feedbackArray = [
        `Transcription: ${data.transcription}`,
        `Confidence: ${data.confidence}%`,
        ...(data.issues?.map((issue: string) => `Issue: ${issue}`) || []),
        ...(data.corrections?.map((correction: string) => `Correction: ${correction}`) || []),
      ];
      setFeedback(feedbackArray.length > 0 ? feedbackArray : ["No feedback available"]);
    } catch (error) {
      console.error("Analyze error:", error);
      setFeedback(["Unable to analyze pronunciation"]);
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Loaded on first switch to the Plan tab rather than on mount — a student who
  // only ever wants pronunciation practice should not pay for a call they never
  // asked for.
  async function loadPlan(strategy: string) {
    setPlanLoading(true);
    try {
      const savedPlan = typeof window !== "undefined" ? localStorage.getItem("studentPersonalizedPlan") : null;
      if (savedPlan && !planLoaded) {
        try {
          setPersonalizedPlan(JSON.parse(savedPlan));
        } catch {
          // ignore invalid saved plan
        }
      }
      const compareParam = strategy === "compare" ? "&compare=true" : "";
      const res = await fetch(`/api/personalize?strategy=${encodeURIComponent(strategy)}${compareParam}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const nextPlan = data.plan || null;
      setPersonalizedPlan(nextPlan);
      if (nextPlan && typeof window !== "undefined") {
        localStorage.setItem("studentPersonalizedPlan", JSON.stringify(nextPlan));
      }
    } catch (err) {
      console.warn("Failed to load personalized plan", err);
    } finally {
      setPlanLoading(false);
      setPlanLoaded(true);
    }
  }

  return (
    <div className="cinematic-card rounded-[32px] p-6 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">AI study tools</p>
          <h2 className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
            {aiTab === "pronunciation" ? "Pronunciation practice" : "Personalized learning path"}
          </h2>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setAiTab("pronunciation")}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${aiTab === "pronunciation" ? "bg-[var(--accent)] text-white shadow-[0_6px_18px_-6px_color-mix(in_srgb,var(--accent)_70%,transparent)]" : "bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          Pronunciation
        </button>
        <button
          type="button"
          onClick={() => {
            setAiTab("plan");
            if (!planLoaded) void loadPlan(plannerStrategy);
          }}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${aiTab === "plan" ? "bg-[var(--accent)] text-white shadow-[0_6px_18px_-6px_color-mix(in_srgb,var(--accent)_70%,transparent)]" : "bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          Study plan
        </button>
      </div>

      {aiTab === "pronunciation" ? (
        <>
          <p className="mt-4 text-sm text-[var(--muted)]">Type your German phrase and get instant AI feedback.</p>
          <textarea
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            rows={4}
            className="mt-4 w-full rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm text-[var(--foreground)] focus:outline-none"
            placeholder="Ich möchte ein Visum beantragen."
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="mt-4 inline-flex w-full items-center justify-center rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {isAnalyzing ? "Analyzing..." : "Analyze pronunciation"}
          </button>
          <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {feedback.map((item, index) => (
              <p key={`${item}-${index}`}>• {item}</p>
            ))}
          </div>
        </>
      ) : (
        <>
          <select
            value={plannerStrategy}
            onChange={(e) => {
              const next = e.target.value;
              setPlannerStrategy(next);
              void loadPlan(next);
            }}
            className="mt-4 w-full rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--foreground)]"
          >
            <option value="deterministic">Deterministic</option>
            <option value="fewshot">Few-shot</option>
            <option value="hybrid">Hybrid</option>
            <option value="compare">A/B compare</option>
          </select>
          <div className="mt-4 space-y-4">
            {planLoading && !personalizedPlan ? (
              <p className="text-sm text-[var(--muted)]">Building your plan…</p>
            ) : personalizedPlan ? (
              <>
                {personalizedPlan.rationale ? <p className="text-sm text-[var(--muted)]">{personalizedPlan.rationale}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(personalizedPlan.lessons || []).slice(0, 4).map((lesson: any, idx: number) => (
                    <div key={lesson.id || idx} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-[var(--surface)]">
                      <p className="font-semibold text-[var(--foreground)]">{lesson.title}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">{lesson.goal}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">Your personalized plan will appear here once the AI recommendation service loads.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
