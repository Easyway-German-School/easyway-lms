"use client";

/**
 * The personalized, illustrated scene experience — what a student with a
 * matching germanyGoal (currently just "care") sees instead of
 * GenericTandemChat. Full-bleed background, an anchored character portrait,
 * a novel-style dialogue box, light branching choices, and one writing beat
 * per chapter, all driven by the same real Whisper/Azure/Claude pipeline
 * the generic experience uses for its speaking beats.
 *
 * State is keyed by {sceneId, beatId} rather than a flat turn index — a
 * choice beat can send two different students down the same next beat with
 * different flavor text, which a linear turnIndex can't represent.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { usePronunciationRecorder } from "@/lib/client/use-pronunciation-recorder";
import type { StoryChapter, StoryCharacter, ExpressionKey } from "@/lib/story/types";
import type { StoryProgress } from "@/lib/story-progress";
import { MicIcon, SpeakerIcon, CheckCircleIcon } from "@/components/icons";

type WriteResult = { score: number; feedback: string; corrections: string[]; achievementTitle: string | null };

export default function VisualNovelStory({ chapter, initialProgress }: { chapter: StoryChapter; initialProgress: StoryProgress }) {
  const [progress, setProgress] = useState(initialProgress);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flavorNote, setFlavorNote] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [writeText, setWriteText] = useState("");
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [pendingProgress, setPendingProgress] = useState<StoryProgress | null>(null);
  const [isSubmittingWrite, setIsSubmittingWrite] = useState(false);

  const characterById = useMemo(() => new Map(chapter.characters.map((character) => [character.id, character])), [chapter]);
  const scene = chapter.scenes[progress.currentSceneId];
  const beat = scene?.beats[progress.currentBeatId];
  const chapterComplete = progress.completedSceneIds.includes(chapter.sceneOrder[chapter.sceneOrder.length - 1]);

  useEffect(() => {
    setWriteText("");
    setWriteResult(null);
    setPendingProgress(null);
    setSpokenResult(null);
    setError(null);
  }, [progress.currentSceneId, progress.currentBeatId]);

  const speakerId = beat && beat.type !== "write" ? beat.speakerId : undefined;
  const speaker: StoryCharacter | undefined = speakerId ? characterById.get(speakerId) : undefined;
  const expression: ExpressionKey = beat?.type === "line" ? beat.expression : speaker?.defaultExpression ?? "neutral";
  const portraitSrc = speaker ? speaker.portraits[expression] ?? speaker.portraits[speaker.defaultExpression] : undefined;

  const [spokenResult, setSpokenResult] = useState<{
    transcription: string; wordAccuracy: number; pronunciationScore: number | null; achievementTitle: string | null;
  } | null>(null);
  const recorder = usePronunciationRecorder({
    expectedPhrase: beat?.type === "yourLine" ? beat.targetPhrase : "",
    onResult: (result) => setSpokenResult(result),
    onError: (message) => setError(message),
  });

  function speakLine(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    setIsSpeaking(true);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    utterance.rate = 0.85;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    const voices = window.speechSynthesis.getVoices();
    const germanVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("de"));
    if (germanVoice) utterance.voice = germanVoice;
    window.speechSynthesis.speak(utterance);
    window.setTimeout(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) setIsSpeaking(false);
    }, 4000);
  }

  async function advance(choiceOptionId?: string, nextFlavorNote?: string) {
    if (!scene || !beat) return;
    setIsAdvancing(true);
    setError(null);
    try {
      const response = await fetch("/api/student/story/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: scene.id, beatId: beat.id, choiceOptionId }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data?.error || "Unable to continue the story."); return; }
      setSpokenResult(null);
      setProgress(data.progress);
      setFlavorNote(nextFlavorNote ?? null);
    } catch {
      setError("Unable to continue the story.");
    } finally {
      setIsAdvancing(false);
    }
  }

  async function submitWrite() {
    if (!scene || beat?.type !== "write" || !writeText.trim()) return;
    setIsSubmittingWrite(true);
    setError(null);
    try {
      const response = await fetch("/api/student/story/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: scene.id, beatId: beat.id, response: writeText.trim() }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data?.error || "Unable to submit your response."); return; }
      setWriteResult({ score: data.score, feedback: data.feedback, corrections: data.corrections ?? [], achievementTitle: data.achievementTitle ?? null });
      setPendingProgress(data.progress);
    } catch {
      setError("Unable to submit your response.");
    } finally {
      setIsSubmittingWrite(false);
    }
  }

  function continueAfterWrite() {
    if (pendingProgress) setProgress(pendingProgress);
    setFlavorNote(null);
  }

  const wordCount = writeText.trim().split(/\s+/).filter(Boolean).length;
  const background = scene?.background;

  if (chapterComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-alt)] p-6 text-[var(--foreground)]">
        <div className="max-w-md rounded-3xl bg-[var(--surface)] p-8 text-center shadow-2xl ring-1 ring-white/10">
          <CheckCircleIcon className="mx-auto h-10 w-10 text-[var(--accent)]" />
          <h1 className="mt-4 text-2xl font-semibold">{chapter.title} — complete</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{chapter.synopsis}</p>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Come back tomorrow for the next chapter of your story — every line you spoke and wrote here was scored for real, not just clicked through.
          </p>
        </div>
      </div>
    );
  }

  if (!scene || !beat) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--surface-alt)] text-[var(--foreground)]">Loading your story…</div>;
  }

  return (
    <div
      className="relative min-h-screen bg-cover bg-center text-white"
      style={{ backgroundImage: `linear-gradient(180deg, rgba(10,20,20,0.35) 0%, rgba(10,15,18,0.85) 78%), linear-gradient(160deg, #0f2027, #1c3f3a)` }}
    >
      {background ? (
        <img
          src={background}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ mixBlendMode: "normal" }}
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-black/80" />

      <div className="relative flex min-h-screen flex-col justify-end px-4 pb-6 pt-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between text-xs uppercase tracking-[0.2em] text-white/70">
          <span>{chapter.title}</span>
          <span>{scene.title}</span>
        </div>

        {speaker ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 items-end justify-center">
            <div className="relative -mb-2 flex h-56 w-44 items-end justify-center sm:h-72 sm:w-56">
              <div className="absolute bottom-0 flex h-40 w-40 items-center justify-center rounded-full bg-[var(--accent)]/30 text-4xl font-black text-white sm:h-48 sm:w-48">
                {speaker.name.slice(0, 1)}
              </div>
              {portraitSrc ? (
                <img
                  src={portraitSrc}
                  alt={speaker.name}
                  className="relative h-full w-full object-contain object-bottom drop-shadow-2xl"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <motion.div
          key={`${scene.id}-${beat.id}-${beat.type === "write" && writeResult ? "graded" : ""}-${beat.type === "yourLine" && spokenResult ? "spoken" : ""}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mx-auto mt-4 w-full max-w-2xl rounded-3xl border border-white/15 bg-black/60 p-5 shadow-2xl backdrop-blur"
        >
            {flavorNote && beat.type === "line" ? <p className="mb-2 text-xs italic text-white/60">{flavorNote}</p> : null}

            {beat.type === "line" && speaker ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{speaker.name} · {speaker.role}</p>
                <p className="mt-2 text-base leading-relaxed">{beat.text}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => speakLine(beat.text)} disabled={isSpeaking} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white disabled:opacity-50">
                    <SpeakerIcon className="h-3.5 w-3.5" /> {isSpeaking ? "Playing…" : "Hear it"}
                  </button>
                  <button type="button" onClick={() => void advance()} disabled={isAdvancing} className="rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white disabled:opacity-60">
                    {isAdvancing ? "…" : "Continue"}
                  </button>
                </div>
              </>
            ) : null}

            {beat.type === "yourLine" && speaker ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">To {speaker.name}</p>
                <p className="mt-2 text-base leading-relaxed">{beat.targetPhrase}</p>
                {!spokenResult ? (
                  <button
                    type="button"
                    onClick={() => void recorder.toggleRecording()}
                    disabled={recorder.isAnalyzing || !recorder.micSupported}
                    className={`mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${recorder.isRecording ? "bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"}`}
                  >
                    <MicIcon className="h-4 w-4" />
                    {recorder.isAnalyzing ? "Coaching your line…" : recorder.isRecording ? `Stop · 0:${String(recorder.recordingSeconds).padStart(2, "0")}` : "Say your line"}
                  </button>
                ) : null}
              </>
            ) : null}

            {beat.type === "choice" && speaker ? (
              <>
                {beat.prompt ? <p className="text-sm text-white/80">{beat.prompt}</p> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {beat.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => void advance(option.id, option.flavorNote)}
                      disabled={isAdvancing}
                      className="rounded-2xl border border-white/20 bg-white/5 p-3 text-left text-sm text-white transition hover:border-[var(--accent)] hover:bg-white/10 disabled:opacity-60"
                    >
                      {option.text}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {beat.type === "write" ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Write it down</p>
                <p className="mt-2 text-sm text-white/85">{beat.prompt}</p>
                {beat.promptGerman ? <p className="mt-1 text-xs italic text-white/60">{beat.promptGerman}</p> : null}
                {!writeResult ? (
                  <>
                    <textarea
                      value={writeText}
                      onChange={(event) => setWriteText(event.target.value)}
                      rows={3}
                      placeholder="Auf Deutsch schreiben…"
                      className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 p-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-white/50">{wordCount} / {beat.minWords} words</span>
                      <button
                        type="button"
                        onClick={() => void submitWrite()}
                        disabled={isSubmittingWrite || !writeText.trim()}
                        className="rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white disabled:opacity-60"
                      >
                        {isSubmittingWrite ? "Grading…" : "Submit"}
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
        </motion.div>

        {beat.type === "yourLine" && spokenResult ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-3 w-full max-w-2xl rounded-2xl border border-white/15 bg-black/50 p-4 backdrop-blur">
            <p className="text-sm text-white">&ldquo;{spokenResult.transcription}&rdquo;</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/70">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><CheckCircleIcon className="h-3.5 w-3.5 text-[var(--accent)]" /> {spokenResult.wordAccuracy}% match</span>
              {spokenResult.pronunciationScore !== null ? <span className="rounded-full bg-white/10 px-2.5 py-1">{spokenResult.pronunciationScore}% pronunciation</span> : null}
              {spokenResult.achievementTitle ? <span className="rounded-full bg-white/10 px-2.5 py-1">{spokenResult.achievementTitle}</span> : null}
            </div>
            <button type="button" onClick={() => void advance()} disabled={isAdvancing} className="mt-3 rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white disabled:opacity-60">
              {isAdvancing ? "…" : "Continue"}
            </button>
          </motion.div>
        ) : null}

        {beat.type === "write" && writeResult ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-3 w-full max-w-2xl rounded-2xl border border-white/15 bg-black/50 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Score: {writeResult.score}%</p>
              {writeResult.achievementTitle ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80">{writeResult.achievementTitle}</span> : null}
            </div>
            <p className="mt-2 text-sm text-white">{writeResult.feedback}</p>
            {writeResult.corrections.length ? <p className="mt-1 text-xs text-white/60">{writeResult.corrections[0]}</p> : null}
            <button type="button" onClick={continueAfterWrite} className="mt-3 rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white">Continue</button>
          </motion.div>
        ) : null}

        {error ? <p className="mx-auto mt-3 w-full max-w-2xl text-sm text-amber-300">{error}</p> : null}
      </div>
    </div>
  );
}
