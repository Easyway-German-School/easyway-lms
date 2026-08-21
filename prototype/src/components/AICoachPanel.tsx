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

import { useEffect, useRef, useState } from "react";

export default function AICoachPanel() {
  const [aiTab, setAiTab] = useState<"pronunciation" | "plan">("pronunciation");
  const [plannerStrategy, setPlannerStrategy] = useState("hybrid");
  const [phrase, setPhrase] = useState("Ich möchte ein Visum beantragen.");
  const [feedback, setFeedback] = useState<string[]>(["Type a phrase and press Analyze."]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [attemptScore, setAttemptScore] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [audioAnalyzed, setAudioAnalyzed] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [personalizedPlan, setPersonalizedPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);

  useEffect(() => {
    const supported = typeof window !== "undefined" && Boolean(window.MediaRecorder) && Boolean((window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    setVoiceSupported(supported);
    const savedBest = Number(window.localStorage.getItem("easyway-voice-best") || 0);
    setBestScore(Number.isFinite(savedBest) ? savedBest : 0);
    return () => {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    };
  }, []);

  function speakModel() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.lang = "de-DE";
    utterance.rate = 0.82;
    const speak = () => {
      const germanVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("de"));
      if (germanVoice) utterance.voice = germanVoice;
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    };
    // Android Chrome often loads voices asynchronously; speaking before the
    // voices list exists produces a silent click with no error.
    if (window.speechSynthesis.getVoices().length) speak();
    else {
      window.speechSynthesis.addEventListener("voiceschanged", speak, { once: true });
      window.setTimeout(speak, 700);
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      return;
    }
    if (!voiceSupported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecordingUrl(URL.createObjectURL(blob));
      };
      const SpeechRecognition = (window as typeof window & { SpeechRecognition?: new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void }; webkitSpeechRecognition?: new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void } }).SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void } }).webkitSpeechRecognition;
      if (!SpeechRecognition) return;
      const recognition = new SpeechRecognition();
      recognition.lang = "de-DE";
      recognition.interimResults = false;
      recognition.continuous = true;
      recognition.onresult = (event) => {
        const words = Array.from({ length: event.results.length }, (_, index) => event.results[index][0].transcript).join(" ");
        setPhrase(words.trim());
      };
      recognition.onerror = () => setFeedback(["I could not hear that clearly. Try again, a little closer to the microphone."]);
      recognitionRef.current = recognition;
      recorder.start();
      recognition.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => Math.min(60, seconds + 1)), 1000);
    } catch {
      setFeedback(["Microphone access was not available. Check your browser permission and try again."]);
    }
  }

  async function handleAnalyze() {
    if (!phrase.trim()) return;
    setIsAnalyzing(true);
    try {
      const recordedBlob = audioChunksRef.current.length ? new Blob(audioChunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" }) : null;
      const res = recordedBlob
        ? await fetch("/api/ai/analyze-pronunciation-audio", { method: "POST", body: (() => { const form = new FormData(); form.append("audio", recordedBlob, "voice-coach.webm"); return form; })() })
        : await fetch("/api/ai/analyze-pronunciation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to coach this attempt");
      setAudioAnalyzed(Boolean(data.audioAnalyzed));
      const feedbackArray = [
        `Transcription: ${data.transcription}`,
        `Confidence: ${data.confidence}%`,
        ...(data.issues?.map((issue: string) => `Issue: ${issue}`) || []),
        ...(data.corrections?.map((correction: string) => `Correction: ${correction}`) || []),
      ];
      setFeedback(feedbackArray.length > 0 ? feedbackArray : ["No feedback available"]);
      setAttemptScore(Math.max(0, Math.min(100, Number(data.confidence) || 0)));
      const score = Math.max(0, Math.min(100, Number(data.confidence) || 0));
      setBestScore((best) => {
        const next = Math.max(best, score);
        window.localStorage.setItem("easyway-voice-best", String(next));
        return next;
      });
      setAttempts((count) => count + 1);
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
            {aiTab === "pronunciation" ? "Voice Coach" : "Personalized learning path"}
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
          <p className="mt-4 text-sm text-[var(--muted)]">Speak a German phrase, hear the model, and get coached on your real attempt. Your microphone audio is used to create the transcript and is not saved.</p>
          <div className="mt-5 rounded-3xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Your challenge</p><p className="mt-1 font-semibold text-[var(--foreground)]">{phrase}</p></div>
              <button type="button" onClick={speakModel} className="rounded-full border border-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent)]">Listen to model</button>
            </div>
          </div>
          {recordingUrl ? <audio controls src={recordingUrl} className="mt-3 w-full" aria-label="Replay your recording" /> : null}
          <button type="button" onClick={() => void toggleRecording()} disabled={!voiceSupported} className={`mt-4 flex w-full items-center justify-center gap-3 rounded-3xl px-4 py-4 text-sm font-bold text-white transition ${isRecording ? "bg-red-600" : "bg-[var(--accent)]"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <span className={`h-3 w-3 rounded-full bg-white ${isRecording ? "animate-pulse" : ""}`} />
            {isRecording ? `Stop recording · 0:${String(recordingSeconds).padStart(2, "0")}` : "Start speaking"}
          </button>
          {!voiceSupported ? <p className="mt-2 text-xs text-[var(--muted)]">Voice capture needs a modern browser with microphone access.</p> : null}
          <textarea
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            rows={4}
            className="mt-4 w-full rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm text-[var(--foreground)] focus:outline-none"
            placeholder="Your transcript appears here after you speak…"
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="mt-4 inline-flex w-full items-center justify-center rounded-3xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {isAnalyzing ? "Coaching your attempt…" : "Get my AI coaching"}
          </button>
          {attemptScore !== null ? <div className="mt-5 flex items-center justify-between rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Attempt {attempts}</p><p className="mt-1 text-sm text-[var(--muted)]">{audioAnalyzed ? "Audio transcript analyzed by the voice service." : "Browser transcript analyzed. Add an audio provider for deeper voice scoring."}</p><p className="mt-2 text-xs font-bold text-[var(--accent)]">Personal best: {bestScore}/100 · +{Math.round(attemptScore / 10)} XP</p></div><p className="text-4xl font-black text-[var(--accent)]">{attemptScore}<span className="text-base">/100</span></p></div> : null}
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
