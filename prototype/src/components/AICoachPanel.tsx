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

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Mascot from "@/components/Mascot";

export default function AICoachPanel() {
  const [aiTab, setAiTab] = useState<"pronunciation" | "plan">("pronunciation");
  const [plannerStrategy, setPlannerStrategy] = useState("hybrid");
  const [targetPhrase] = useState("Ich möchte ein Visum beantragen.");
  const [phrase, setPhrase] = useState(targetPhrase);
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
  const [nextPractice, setNextPractice] = useState<string | null>(null);
  const [practicePhrase, setPracticePhrase] = useState<string>(targetPhrase);
  const [wordAccuracy, setWordAccuracy] = useState<number | null>(null);
  const [missingWords, setMissingWords] = useState<string[]>([]);
  const [extraWords, setExtraWords] = useState<string[]>([]);
  const [showCoachDialog, setShowCoachDialog] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [personalizedPlan, setPersonalizedPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0.45);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voiceBars = Array.from({ length: 32 }, (_, index) => index);

  function stopVoiceMeter() {
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    setVoiceLevel(0.45);
  }

  function startVoiceMeter(stream: MediaStream) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const average = data.reduce((sum, value) => sum + value, 0) / data.length / 255;
        setVoiceLevel(Math.max(0.16, Math.min(1, average * 2.8)));
        animationFrameRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setVoiceLevel(0.55);
    }
  }

  useEffect(() => {
    const supported = typeof window !== "undefined" && Boolean(window.MediaRecorder) && Boolean((window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    setVoiceSupported(supported);
    const savedBest = Number(window.localStorage.getItem("easyway-voice-best") || 0);
    setBestScore(Number.isFinite(savedBest) ? savedBest : 0);
    return () => {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      audioRef.current?.pause();
      stopVoiceMeter();
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    };
  }, []);

  function speakInBrowser(text = targetPhrase) {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    utterance.rate = 0.82;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
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
    window.setTimeout(() => {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
      setIsSpeaking(false);
      stopVoiceMeter();
    }, 3500);
    return true;
  }

  async function speakModel(text = targetPhrase) {
    if (!text.trim()) return;
    setIsSpeaking(true);
    // Start synchronously inside the click gesture. A voice fetched after an
    // await can be blocked by mobile autoplay rules, so browser speech is the
    // immediate fallback while the higher-quality Piper audio is requested.
    const browserStarted = speakInBrowser(text);
    try {
      const response = await fetch("/api/ai/voice-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) throw new Error("Open-source voice provider unavailable");
      if (browserStarted && typeof window !== "undefined") window.speechSynthesis.cancel();
      setIsSpeaking(true);
      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        setIsSpeaking(false);
        stopVoiceMeter();
      };
      await audio.play();
    } catch {
      if (!browserStarted && !speakInBrowser(text)) {
        setIsSpeaking(false);
        stopVoiceMeter();
      }
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      recognitionRef.current?.stop();
      setIsRecording(false);
      stopVoiceMeter();
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
        stopVoiceMeter();
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
      startVoiceMeter(stream);
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
        ? await fetch("/api/ai/analyze-pronunciation-audio", { method: "POST", body: (() => { const form = new FormData(); form.append("audio", recordedBlob, "voice-coach.webm"); form.append("expectedPhrase", targetPhrase); return form; })() })
        : await fetch("/api/ai/analyze-pronunciation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase, expectedPhrase: targetPhrase }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to coach this attempt");
      setAudioAnalyzed(Boolean(data.audioAnalyzed));
      setNextPractice(typeof data.nextPractice === "string" ? data.nextPractice : null);
      setPracticePhrase(typeof data.practicePhrase === "string" ? data.practicePhrase : targetPhrase);
      setWordAccuracy(typeof data.wordAccuracy === "number" ? data.wordAccuracy : null);
      setMissingWords(Array.isArray(data.missingWords) ? data.missingWords : []);
      setExtraWords(Array.isArray(data.extraWords) ? data.extraWords : []);
      const feedbackArray = [
        `Transcription: ${data.transcription}`,
        `Word match: ${data.wordAccuracy ?? data.confidence}%${data.missingWords?.length ? ` · Missing: ${data.missingWords.join(", ")}` : ""}${data.extraWords?.length ? ` · Extra: ${data.extraWords.join(", ")}` : ""}`,
        `Confidence: ${data.confidence}%`,
        ...(data.issues?.map((issue: string) => `Issue: ${issue}`) || []),
        ...(data.corrections?.map((correction: string) => `Correction: ${correction}`) || []),
        ...(data.nextPractice ? [`Next practice: ${data.nextPractice}`] : []),
      ];
      setFeedback(feedbackArray.length > 0 ? feedbackArray : ["No feedback available"]);
      const score = Math.max(0, Math.min(100, Number(data.wordAccuracy ?? data.confidence) || 0));
      setAttemptScore(score);
      setBestScore((best) => {
        const next = Math.max(best, score);
        window.localStorage.setItem("easyway-voice-best", String(next));
        return next;
      });
      setAttempts((count) => count + 1);
      setShowCoachDialog(true);
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
          {(isSpeaking || isRecording) ? (
            <div className={`voice-stage mt-5 ${isRecording ? "voice-stage-recording" : "voice-stage-speaking"}`} role="status" aria-live="polite">
              <div className="voice-stage-grid" />
              <div className="voice-orbit voice-orbit-one" />
              <div className="voice-orbit voice-orbit-two" />
              <div className="voice-core"><span>{isRecording ? "REC" : "AI"}</span></div>
              <div className="voice-wave" style={{ "--voice-level": voiceLevel } as CSSProperties}>
                {voiceBars.map((bar) => <span key={bar} style={{ "--bar-delay": `${bar * 32}ms`, "--bar-height": `${22 + Math.sin(bar * 0.8) * 15 + (bar % 5) * 6}px` } as CSSProperties} />)}
              </div>
              <div className="voice-stage-label"><strong>{isRecording ? "I’m listening" : "Model pronunciation"}</strong><small>{isRecording ? `Speak naturally · 0:${String(recordingSeconds).padStart(2, "0")}` : "Listen for the rhythm, then make it yours"}</small></div>
            </div>
          ) : null}
          <div className="mt-5 rounded-3xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Your challenge</p><p className="mt-1 font-semibold text-[var(--foreground)]">{targetPhrase}</p></div>
              <button type="button" onClick={() => void speakModel()} disabled={isSpeaking} className="rounded-full border border-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent)] disabled:cursor-wait disabled:opacity-60">{isSpeaking ? "Preparing voice…" : "Listen to model"}</button>
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
          {attemptScore !== null ? <div className="mt-5 flex items-center justify-between rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Attempt {attempts}</p><p className="mt-1 text-sm text-[var(--muted)]">{audioAnalyzed ? "Recording transcribed, then coached against the target sentence." : "Transcript coached against the target sentence."}</p><p className="mt-2 text-xs font-bold text-[var(--accent)]">Personal best: {bestScore}/100 · +{Math.round(attemptScore / 10)} XP</p></div><p className="text-4xl font-black text-[var(--accent)]">{attemptScore}<span className="text-base">/100</span></p></div> : null}
          <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {feedback.map((item, index) => (
              <p key={`${item}-${index}`}>• {item}</p>
            ))}
          </div>
          {nextPractice ? (
            <div className="mt-5 flex items-center gap-3 rounded-3xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
              <Mascot mood="cheerful" className="h-16 w-14 shrink-0" />
              <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Becca&apos;s next drill</p><p className="mt-1 text-sm text-[var(--foreground)]">{nextPractice}</p></div>
              <button type="button" onClick={() => void speakModel(practicePhrase)} className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white">Hear it</button>
            </div>
          ) : null}
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
      {showCoachDialog && attemptScore !== null ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="voice-coach-result">
          <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-[var(--accent)]/40 bg-[var(--surface)] p-6 shadow-2xl">
            <button type="button" onClick={() => setShowCoachDialog(false)} aria-label="Close coaching result" className="absolute right-4 top-4 rounded-full px-3 py-1 text-xl text-[var(--muted)] hover:text-[var(--foreground)]">×</button>
            <div className="flex items-center gap-4"><Mascot mood={attemptScore >= 80 ? "cheerful" : "thinking"} className="h-24 w-20 shrink-0" /><div><p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Becca&apos;s voice review</p><h3 id="voice-coach-result" className="mt-1 text-2xl font-bold text-[var(--foreground)]">{attemptScore >= 80 ? "Strong attempt" : "Good start, let&apos;s sharpen it"}</h3><p className="mt-1 text-sm text-[var(--muted)]">Measured from the words your recording produced.</p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-[var(--surface-alt)] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Word match</p><p className="mt-1 text-3xl font-black text-[var(--accent)]">{wordAccuracy ?? attemptScore}%</p></div><div className="rounded-2xl bg-[var(--surface-alt)] p-4"><p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Attempt</p><p className="mt-1 text-3xl font-black text-[var(--foreground)]">{attempts}</p></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">What you did well</p><p className="mt-1 text-sm text-[var(--foreground)]">{wordAccuracy === 100 ? "You said every target word the recognizer expected." : "You kept part of the target sentence in the right order."}</p></div><div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-300">What to sharpen</p><p className="mt-1 text-sm text-[var(--foreground)]">{missingWords.length ? `Missing: ${missingWords.join(", ")}` : extraWords.length ? `Extra: ${extraWords.join(", ")}` : "No missing or extra words were detected."}</p></div></div>
            <div className="mt-4 space-y-2 text-sm text-[var(--foreground)]">{feedback.filter((item) => /Missing:|Extra:|Issue:|Correction:/i.test(item)).slice(0, 5).map((item, index) => <p key={`${item}-${index}`} className="rounded-xl border border-[var(--border)] px-3 py-2">{item}</p>)}</div>
            {nextPractice ? <div className="mt-4 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Your next practice</p><p className="mt-1 text-sm text-[var(--foreground)]">{nextPractice}</p><p className="mt-2 text-sm font-semibold text-[var(--accent)]">{practicePhrase}</p><button type="button" onClick={() => void speakModel(practicePhrase)} className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white">Listen to Becca&apos;s drill</button></div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
