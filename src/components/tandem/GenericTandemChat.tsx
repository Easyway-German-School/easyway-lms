"use client";

/**
 * The original /tandem experience: a scripted, linear chat-thread roleplay.
 * Kept as-is (pixel-identical to what shipped) for every student whose
 * germanyGoal has no personalized story series — see storySeriesFor() in
 * lib/story/content — so the relational/open-ended goal tracks (family,
 * aupair, settle, explore, custom) cost nothing to keep unchanged.
 */

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { usePronunciationRecorder } from "@/lib/client/use-pronunciation-recorder";
import { MicIcon, SpeakerIcon, CheckCircleIcon, ChevronRightIcon, RefreshIcon } from "@/components/icons";

type ScriptTurn = { partnerLine: string; yourLine: string };

type Scenario = {
  title: string;
  character: string;
  intro: string;
  script: ScriptTurn[];
};

const scenarios: Scenario[] = [
  {
    title: "Herr Schmidt at the Embassy",
    character: "Herr Schmidt",
    intro: "A friendly embassy officer, reviewing your visa registration.",
    script: [
      { partnerLine: "Guten Tag! Wie kann ich Ihnen helfen?", yourLine: "Guten Tag, ich möchte ein Visum beantragen." },
      { partnerLine: "Sehr gut. Haben Sie schon einen Termin vereinbart?", yourLine: "Nein, ich habe noch keinen Termin. Wann ist der nächste freie Termin?" },
      { partnerLine: "Der nächste Termin ist am Montag um zehn Uhr. Passt das für Sie?", yourLine: "Ja, das passt gut. Vielen Dank für Ihre Hilfe." },
    ],
  },
  {
    title: "A landlord in Berlin",
    character: "Frau Keller",
    intro: "A landlord showing you a new apartment.",
    script: [
      { partnerLine: "Willkommen! Das ist die Wohnung. Was möchten Sie zuerst sehen?", yourLine: "Ich möchte gerne die Küche und das Badezimmer sehen." },
      { partnerLine: "Natürlich, hier entlang. Die Küche ist neu renoviert.", yourLine: "Das sieht wirklich schön aus. Ist die Miete monatlich fällig?" },
      { partnerLine: "Ja, genau. Die Kaution beträgt zwei Monatsmieten.", yourLine: "Verstanden. Wann kann ich einziehen?" },
    ],
  },
];

type Coaching = {
  wordAccuracy: number;
  pronunciationScore: number | null;
  issues: string[];
  corrections: string[];
  missingWords: string[];
  achievementTitle: string | null;
};

type Message =
  | { id: string; speaker: "partner"; text: string }
  | { id: string; speaker: "you"; text: string; coaching: Coaching };

export default function GenericTandemChat() {
  const [scenarioIndex, setScenarioIndex] = useState<number | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [completed, setCompleted] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const currentScenario = scenarioIndex !== null ? scenarios[scenarioIndex] : null;
  const currentYourLine = currentScenario && !completed ? currentScenario.script[turnIndex].yourLine : null;
  const averageScore = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;

  const recorder = usePronunciationRecorder({
    expectedPhrase: currentYourLine ?? "",
    onResult: (result) => {
      if (scenarioIndex === null) return;
      const scenario = scenarios[scenarioIndex];
      const coaching: Coaching = {
        wordAccuracy: result.wordAccuracy,
        pronunciationScore: result.pronunciationScore,
        issues: result.issues,
        corrections: result.corrections,
        missingWords: result.missingWords,
        achievementTitle: result.achievementTitle,
      };
      const youMessage: Message = { id: `you-${scenarioIndex}-${turnIndex}`, speaker: "you", text: result.transcription, coaching };
      setScores((prev) => [...prev, coaching.wordAccuracy]);

      const nextTurn = turnIndex + 1;
      if (nextTurn < scenario.script.length) {
        setMessages((prev) => [
          ...prev,
          youMessage,
          { id: `p${nextTurn}-${scenarioIndex}`, speaker: "partner", text: scenario.script[nextTurn].partnerLine },
        ]);
        setTurnIndex(nextTurn);
      } else {
        setMessages((prev) => [...prev, youMessage]);
        setCompleted(true);
      }
    },
  });

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, recorder.isRecording]);

  function startScenario(index: number) {
    const scenario = scenarios[index];
    setScenarioIndex(index);
    setTurnIndex(0);
    setCompleted(false);
    setScores([]);
    setMessages([{ id: `p0-${index}`, speaker: "partner", text: scenario.script[0].partnerLine }]);
  }

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: "easeOut" }}
      className="min-h-screen bg-[var(--surface-alt)] py-10 text-[var(--foreground)]"
    >
      <div className="mx-auto max-w-3xl space-y-6 px-6 md:px-10">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-2xl ring-1 ring-white/10">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">AI Tandem Partner</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Roleplay a real conversation</h1>
          <p className="mt-4 text-[var(--muted)]">
            Play out a scene line by line. Say your part out loud and get real coaching — transcribed by Whisper,
            scored phoneme-by-phoneme by Azure, and reviewed by Becca — before the conversation continues.
          </p>
        </header>

        {scenarioIndex === null ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {scenarios.map((scenario, index) => (
              <button
                key={scenario.title}
                onClick={() => startScenario(index)}
                className="rounded-3xl border border-[rgba(148,163,184,0.25)] bg-[var(--surface)] p-5 text-left shadow-sm ring-1 ring-white/10 transition hover:-translate-y-1 hover:border-[var(--accent)]"
              >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{scenario.character}</p>
                <h3 className="mt-2 font-semibold text-[var(--foreground)]">{scenario.title}</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">{scenario.intro}</p>
                <p className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                  Start scene <ChevronRightIcon className="h-3.5 w-3.5" />
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-[var(--surface)] p-5 shadow-sm ring-1 ring-white/10 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{currentScenario!.character}</p>
                <p className="text-sm text-[var(--muted)]">{currentScenario!.title}</p>
              </div>
              <div className="flex items-center gap-2">
                {currentScenario!.script.map((_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 w-6 rounded-full ${index < scores.length ? "bg-[var(--accent)]" : index === turnIndex && !completed ? "bg-[var(--accent)]/40" : "bg-[rgba(148,163,184,0.25)]"}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setScenarioIndex(null)}
                  className="ml-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Change scene
                </button>
              </div>
            </div>

            <div className="mt-5 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {messages.map((message) =>
                message.speaker === "partner" ? (
                  <div key={message.id} className="flex items-start gap-2">
                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-bold text-[var(--muted)] ring-1 ring-white/10">
                      {currentScenario!.character.slice(0, 1)}
                    </span>
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--foreground)]">
                      <p>{message.text}</p>
                      <button
                        type="button"
                        onClick={() => speakLine(message.text)}
                        disabled={isSpeaking}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
                      >
                        <SpeakerIcon className="h-3.5 w-3.5" /> {isSpeaking ? "Playing…" : "Hear it"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="flex flex-col items-end gap-1">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--accent)] px-4 py-2.5 text-sm text-white">
                      <p>{message.text}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === message.id ? null : message.id)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)] ring-1 ring-white/10 hover:text-[var(--foreground)]"
                    >
                      <CheckCircleIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
                      {message.coaching.wordAccuracy}% match
                      {message.coaching.pronunciationScore !== null ? ` · ${message.coaching.pronunciationScore}% pronunciation` : ""}
                      {message.coaching.achievementTitle ? ` · ${message.coaching.achievementTitle}` : ""}
                    </button>
                    {expandedId === message.id ? (
                      <div className="max-w-[80%] rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-left text-xs text-[var(--muted)]">
                        {message.coaching.corrections.length ? (
                          <p className="text-[var(--foreground)]">{message.coaching.corrections[0]}</p>
                        ) : message.coaching.issues.length ? (
                          <p className="text-[var(--foreground)]">{message.coaching.issues[0]}</p>
                        ) : (
                          <p>Clean attempt — nothing to correct here.</p>
                        )}
                        {message.coaching.missingWords.length ? (
                          <p className="mt-1">Missing: {message.coaching.missingWords.join(", ")}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              )}

              {currentYourLine ? (
                <div className="flex flex-col items-end gap-2">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm border border-dashed border-[var(--accent)]/50 bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-[var(--foreground)]">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Your line</p>
                    <p className="mt-1">{currentYourLine}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void recorder.toggleRecording()}
                    disabled={recorder.isAnalyzing || !recorder.micSupported}
                    className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${recorder.isRecording ? "bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"}`}
                  >
                    <MicIcon className="h-4 w-4" />
                    {recorder.isAnalyzing ? "Coaching your line…" : recorder.isRecording ? `Stop · 0:${String(recorder.recordingSeconds).padStart(2, "0")}` : "Say your line"}
                  </button>
                </div>
              ) : null}

              {completed ? (
                <div className="flex items-start gap-2 rounded-2xl bg-[var(--accent-soft)] p-4">
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">Scene complete — {averageScore}% average match</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Every line was scored against what you actually said, not a script you clicked through.
                    </p>
                    <button
                      type="button"
                      onClick={() => startScenario(scenarioIndex!)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent)]"
                    >
                      <RefreshIcon className="h-3.5 w-3.5" /> Play this scene again
                    </button>
                  </div>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>

            {recorder.error ? <p className="mt-3 text-sm text-amber-600">{recorder.error}</p> : null}
          </div>
        )}
      </div>
    </motion.div>
  );
}
