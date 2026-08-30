"use client";

/**
 * The personalized, illustrated scene experience — what a student with a
 * matching germanyGoal (care/ausbildung/work/study) sees instead of
 * GenericTandemChat. Full-bleed background, an anchored character portrait,
 * a novel-style dialogue box, real branching choices, a persistent
 * relationship meter, and one writing beat per episode, all driven by the
 * same real Whisper/Azure/Claude pipeline the generic experience uses for
 * its speaking beats.
 *
 * This is a SERIES, not a single chapter: `access` (a StoryAccessState) is
 * the single source of truth for which of three modes we're in — mid-episode
 * ("playable"), between episodes with the next one's day-gate not yet open
 * ("locked"), or every written episode finished ("season-complete"). The
 * server decides which state applies; this component just renders whichever
 * one it's handed and re-fetches it after every mutation.
 *
 * State is keyed by {sceneId, beatId} rather than a flat turn index — a
 * choice beat can send two different students down genuinely different next
 * beats, which a linear turnIndex can't represent.
 *
 * RELATIONSHIP MEMORY: `access.relationships` is a 0-100 trust score per
 * character, computed server-side and carried across the whole series (not
 * reset each episode — see story-progress.ts). `pickLineVariant` picks the
 * highest-trust line a `line` beat qualifies to show; this is how a
 * character visibly remembers earlier choices without the scene graph
 * itself branching.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePronunciationRecorder } from "@/lib/client/use-pronunciation-recorder";
import { pickLineVariant, type StoryCharacter, type ExpressionKey } from "@/lib/story/types";
import type { StoryAccessState } from "@/lib/story-progress";
import { STORY_EPISODE_XP } from "@/lib/gamification";
import { MicIcon, SpeakerIcon, CheckCircleIcon, ClockIcon, HeartIcon, SparklesIcon } from "@/components/icons";

type WriteResult = { score: number; feedback: string; corrections: string[]; achievementTitle: string | null };
type TrustChange = { characterId: string; delta: number; newValue: number } | null;

const TYPEWRITER_MS_PER_CHAR = 16;

function useCountdown(targetIso: string | undefined): string {
  const [label, setLabel] = useState("soon");
  useEffect(() => {
    if (!targetIso) return;
    const target = new Date(targetIso).getTime();
    const tick = () => {
      const remainingMs = target - Date.now();
      if (remainingMs <= 0) { setLabel("now"); return; }
      const hours = Math.floor(remainingMs / 3_600_000);
      const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
      setLabel(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    };
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, [targetIso]);
  return label;
}

/** Reveals `text` one character at a time. `skip()` jumps straight to the full text — used when the player taps ahead of the reveal. */
function useTypewriter(text: string) {
  const [shown, setShown] = useState(text);
  const [done, setDone] = useState(true);
  const skippedRef = useRef(false);

  useEffect(() => {
    skippedRef.current = false;
    if (!text) { setShown(""); setDone(true); return; }
    setShown("");
    setDone(false);
    const chars = Array.from(text);
    let i = 0;
    const interval = window.setInterval(() => {
      if (skippedRef.current) return;
      i += 1;
      setShown(chars.slice(0, i).join(""));
      if (i >= chars.length) { setDone(true); window.clearInterval(interval); }
    }, TYPEWRITER_MS_PER_CHAR);
    return () => window.clearInterval(interval);
  }, [text]);

  function skip() {
    skippedRef.current = true;
    setShown(text);
    setDone(true);
  }

  return { shown, done, skip };
}

/** Small heart meter under a speaker's name — the only visible trace of the series-wide trust score. */
function TrustMeter({ value }: { value: number }) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <HeartIcon className="h-3 w-3 shrink-0 text-[var(--accent)]" />
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/15">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export default function VisualNovelStory({ initialAccess }: { initialAccess: StoryAccessState }) {
  const [access, setAccess] = useState<StoryAccessState>(initialAccess);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flavorNote, setFlavorNote] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [trustToast, setTrustToast] = useState<{ characterName: string; delta: number } | null>(null);

  const [writeText, setWriteText] = useState("");
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [pendingAccess, setPendingAccess] = useState<StoryAccessState | null>(null);
  const [isSubmittingWrite, setIsSubmittingWrite] = useState(false);
  const [spokenResult, setSpokenResult] = useState<{
    transcription: string; wordAccuracy: number; pronunciationScore: number | null; achievementTitle: string | null;
  } | null>(null);

  const playable = access.state === "playable" ? access : null;
  const chapter = playable?.chapter;
  const progress = playable?.progress;
  const relationships = playable?.relationships ?? {};
  const characterById = useMemo(() => new Map((chapter?.characters ?? []).map((character) => [character.id, character])), [chapter]);
  const scene = chapter && progress ? chapter.scenes[progress.currentSceneId] : undefined;
  const beat = scene && progress ? scene.beats[progress.currentBeatId] : undefined;

  const countdown = useCountdown(access.state === "locked" ? access.unlocksAt : undefined);

  useEffect(() => {
    if (!progress) return;
    setWriteText("");
    setWriteResult(null);
    setPendingAccess(null);
    setSpokenResult(null);
    setError(null);
  }, [progress?.currentSceneId, progress?.currentBeatId]);

  useEffect(() => {
    if (!trustToast) return;
    const timeout = window.setTimeout(() => setTrustToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [trustToast]);

  const speakerId = beat && beat.type !== "write" ? beat.speakerId : undefined;
  const speaker: StoryCharacter | undefined = speakerId ? characterById.get(speakerId) : undefined;

  // A `line` beat may carry higher-trust rewrites — pick the one this
  // player's history with the speaker actually qualifies for.
  const resolvedLine = beat?.type === "line" ? pickLineVariant(relationships, beat) : null;
  const expression: ExpressionKey = resolvedLine ? resolvedLine.expression : speaker?.defaultExpression ?? "neutral";
  const portraitSrc = speaker ? speaker.portraits[expression] ?? speaker.portraits[speaker.defaultExpression] : undefined;
  const trustValue = speaker ? relationships[speaker.id] ?? 50 : 50;

  // Whatever's actually read aloud/typed out for the current beat — the one
  // string the typewriter effect below animates in, regardless of beat type.
  const primaryText =
    beat?.type === "line" ? resolvedLine?.text ?? "" :
    beat?.type === "yourLine" ? beat.targetPhrase :
    beat?.type === "choice" ? beat.prompt ?? "" :
    "";
  const typewriter = useTypewriter(primaryText);

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
    if (!typewriter.done) { typewriter.skip(); return; }
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
      setAccess(data.access);
      setFlavorNote(nextFlavorNote ?? null);
      const trustChange = data.trustChange as TrustChange;
      if (trustChange && trustChange.delta) {
        const name = characterById.get(trustChange.characterId)?.name ?? "";
        setTrustToast({ characterName: name, delta: trustChange.delta });
      }
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
      setPendingAccess(data.access);
    } catch {
      setError("Unable to submit your response.");
    } finally {
      setIsSubmittingWrite(false);
    }
  }

  function continueAfterWrite() {
    if (pendingAccess) setAccess(pendingAccess);
    setFlavorNote(null);
  }

  const wordCount = writeText.trim().split(/\s+/).filter(Boolean).length;
  const background = scene?.background;
  const justFinishedEpisode = access.state === "locked" || access.state === "season-complete";

  if (access.state === "locked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-alt)] p-6 text-[var(--foreground)]">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="max-w-md rounded-3xl bg-[var(--surface)] p-8 text-center shadow-2xl ring-1 ring-white/10"
        >
          <CheckCircleIcon className="mx-auto h-10 w-10 text-[var(--accent)]" />
          <h1 className="mt-4 text-2xl font-semibold">{access.completedChapter.title} — complete</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Every line you spoke and wrote here was scored for real, not just clicked through.
          </p>
          {justFinishedEpisode ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 260, damping: 18 }}
              className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/15 px-4 py-1.5 text-sm font-bold text-[var(--accent)]"
            >
              <SparklesIcon className="h-4 w-4" /> +{STORY_EPISODE_XP} XP · Episode complete
            </motion.div>
          ) : null}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-left">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              <ClockIcon className="h-3.5 w-3.5" /> Next: unlocks in {countdown}
            </p>
            <p className="mt-2 text-sm font-semibold">{access.nextChapter.title}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{access.nextChapter.synopsis}</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (access.state === "season-complete") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-alt)] p-6 text-[var(--foreground)]">
        <div className="max-w-md rounded-3xl bg-[var(--surface)] p-8 text-center shadow-2xl ring-1 ring-white/10">
          <CheckCircleIcon className="mx-auto h-10 w-10 text-[var(--accent)]" />
          <h1 className="mt-4 text-2xl font-semibold">{access.completedChapter.title} — complete</h1>
          <p className="mt-4 text-sm text-[var(--muted)]">
            You've finished every episode of your story so far. More is coming — check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (!chapter || !scene || !beat || !progress) {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--surface-alt)] text-[var(--foreground)]">Loading your story…</div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-cover bg-center text-white">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `linear-gradient(180deg, rgba(10,20,20,0.35) 0%, rgba(10,15,18,0.85) 78%), linear-gradient(160deg, #0f2027, #1c3f3a)` }}
      />
      <AnimatePresence mode="sync">
        {background ? (
          <motion.img
            key={background}
            src={background}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1.1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.7 }, scale: { duration: 22, ease: "linear" } }}
            onError={(event) => { event.currentTarget.style.display = "none"; }}
          />
        ) : null}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-black/80" />

      <div className="relative flex min-h-screen flex-col justify-end px-4 pb-6 pt-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between text-xs uppercase tracking-[0.2em] text-white/70">
          <span>{chapter.title} · Episode {playable.episodeIndex + 1}</span>
          <span>{scene.title}</span>
        </div>

        {speaker ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 items-end justify-center">
            <div className="relative -mb-2 flex h-56 w-44 items-end justify-center sm:h-72 sm:w-56">
              <div className="absolute bottom-0 flex h-40 w-40 items-center justify-center rounded-full bg-[var(--accent)]/30 text-4xl font-black text-white sm:h-48 sm:w-48">
                {speaker.name.slice(0, 1)}
              </div>
              <AnimatePresence mode="wait">
                {portraitSrc ? (
                  <motion.img
                    key={portraitSrc}
                    src={portraitSrc}
                    alt={speaker.name}
                    className="relative h-full w-full object-contain object-bottom drop-shadow-2xl"
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="pointer-events-none relative mx-auto mt-4 flex w-full max-w-2xl justify-end">
          <AnimatePresence>
            {trustToast ? (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute -top-8 inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur"
              >
                <HeartIcon className="h-3 w-3 text-[var(--accent)]" />
                {trustToast.delta > 0 ? "+" : ""}{trustToast.delta} {trustToast.characterName}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <motion.div
          key={`${scene.id}-${beat.id}-${beat.type === "write" && writeResult ? "graded" : ""}-${beat.type === "yourLine" && spokenResult ? "spoken" : ""}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => { if (!typewriter.done) typewriter.skip(); }}
          className="mx-auto mt-2 w-full max-w-2xl cursor-pointer rounded-3xl border border-white/15 bg-black/60 p-5 shadow-2xl backdrop-blur"
        >
            {flavorNote && beat.type === "line" ? <p className="mb-2 text-xs italic text-white/60">{flavorNote}</p> : null}

            {beat.type === "line" && speaker ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{speaker.name} · {speaker.role}</p>
                <TrustMeter value={trustValue} />
                <p className="mt-2 min-h-[3em] text-base leading-relaxed">{typewriter.shown}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); speakLine(resolvedLine?.text ?? ""); }} disabled={isSpeaking} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white disabled:opacity-50">
                    <SpeakerIcon className="h-3.5 w-3.5" /> {isSpeaking ? "Playing…" : "Hear it"}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void advance(); }}
                    disabled={isAdvancing}
                    className="rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {isAdvancing ? "…" : typewriter.done ? "Continue" : "Skip"}
                  </button>
                </div>
              </>
            ) : null}

            {beat.type === "yourLine" && speaker ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">To {speaker.name}</p>
                <TrustMeter value={trustValue} />
                <p className="mt-2 min-h-[3em] text-base leading-relaxed">{typewriter.shown}</p>
                {!spokenResult ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void recorder.toggleRecording(); }}
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
                {beat.prompt ? <p className="min-h-[2.5em] text-sm text-white/80">{typewriter.shown}</p> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {beat.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void advance(option.id, option.flavorNote); }}
                      disabled={isAdvancing || !typewriter.done}
                      className="rounded-2xl border border-white/20 bg-white/5 p-3 text-left text-sm text-white transition hover:border-[var(--accent)] hover:bg-white/10 disabled:opacity-40"
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
                      onClick={(e) => e.stopPropagation()}
                      rows={3}
                      placeholder="Auf Deutsch schreiben…"
                      className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 p-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-white/50">{wordCount} / {beat.minWords} words</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void submitWrite(); }}
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
              {(spokenResult.pronunciationScore ?? 0) >= 80 || spokenResult.wordAccuracy >= 90 ? (
                <motion.span
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 16 }}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/20 px-2.5 py-1 font-bold text-[var(--accent)]"
                >
                  <SparklesIcon className="h-3 w-3" /> Nailed it
                </motion.span>
              ) : null}
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
              <div className="flex items-center gap-2">
                {writeResult.score >= 80 ? (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 16 }}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/20 px-2 py-1 text-xs font-bold text-[var(--accent)]"
                  >
                    <SparklesIcon className="h-3 w-3" /> Nailed it
                  </motion.span>
                ) : null}
                {writeResult.achievementTitle ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80">{writeResult.achievementTitle}</span> : null}
              </div>
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
