"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const scenarios = [
  {
    title: "Herr Schmidt at the Embassy",
    prompt: "Du bist Herr Schmidt, ein freundlicher deutscher Beamter. Stelle einfache Fragen zur Visumsanmeldung.",
  },
  {
    title: "A landlord in Berlin",
    prompt: "Du bist ein Vermieter, der einer neuen Mieterin die Wohnung zeigt. Stelle Fragen zum Umzug und zu den Möbeln.",
  },
];

export default function TandemPartner() {
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([
    "Speak naturally and the browser will transcribe your German phrase in real time.",
  ]);
  const [transcript, setTranscript] = useState("No recording yet.");
  const [recognition, setRecognition] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Browser speech recognition is not available in this browser.");
      return;
    }

    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = false;
    recognitionInstance.lang = "de-DE";

    recognitionInstance.onresult = (event: any) => {
      const spokenText = Array.from(event.results)
        .map((result: any) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (spokenText) {
        setTranscript(spokenText);
        void sendPronunciation(spokenText);
      }
    };

    recognitionInstance.onerror = (event: any) => {
      setIsRecording(false);
      if (event.error === "not-allowed") {
        setError(
          "Microphone access denied. Please enable microphone permissions and try again."
        );
        setFeedback(["❌ Microphone permission required. Check browser settings."]);
      } else if (event.error === "network") {
        setFeedback(["Network error. Please check your connection and try again."]);
      } else if (event.error === "no-speech") {
        setFeedback(["No speech detected. Speak clearly and try again."]);
      } else {
        setFeedback([`Speech recognition error: ${event.error}`]);
      }
    };

    recognitionInstance.onend = () => {
      setIsRecording(false);
    };

    setRecognition(recognitionInstance);

    return () => recognitionInstance.stop();
  }, []);

  async function startRecording() {
    if (!recognition) {
      setFeedback(["Speech recognition is not supported in this browser."]);
      return;
    }

    try {
      setError(null);
      setIsRecording(true);
      setFeedback(["Listening for your German phrase... Speak clearly."]);
      setTranscript("...");
      recognition.start();
    } catch (err: any) {
      setIsRecording(false);
      if (err.name === "NotAllowedError") {
        setError(
          "Microphone access denied. Please enable microphone permissions in your browser settings and try again."
        );
        setFeedback(["❌ Microphone permission required. Check browser permissions."]);
      } else {
        setError(`Error: ${err.message}`);
        setFeedback([`Error starting recording: ${err.message}`]);
      }
    }
  }

  function stopRecording() {
    recognition?.stop();
    setIsRecording(false);
    setFeedback(["Listening stopped. You can record again whenever you want."]);
  }

  async function sendPronunciation(text: string) {
    setFeedback(["Analyzing your phrasing and scenario fit..."]);

    try {
      const response = await fetch("/api/voice-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, scenario: scenarios[selectedScenario].title }),
      });
      const json = await response.json();
      setTranscript(json.transcript || text);
      setFeedback(json.tips || ["Feedback could not be generated."]);
    } catch (error) {
      console.error(error);
      setFeedback(["Unable to reach the voice practice API."]);
    }
  }

  const scenarioCards = useMemo(
    () =>
      scenarios.map((scenario, index) => (
        <button
          key={scenario.title}
          onClick={() => setSelectedScenario(index)}
          className={`rounded-2xl border px-4 py-3 text-left transition ${
            selectedScenario === index
              ? "border-[var(--accent)] bg-[var(--surface-alt)] text-[var(--foreground)]"
              : "border-[rgba(148,163,184,0.25)] bg-[var(--surface)] hover:border-[var(--accent)] text-[var(--foreground)]"
          }`}
        >
          <h3 className="font-semibold text-[var(--foreground)]">{scenario.title}</h3>
          <p className="mt-2 text-sm text-[var(--muted)]">{scenario.prompt}</p>
        </button>
      )),
    [selectedScenario]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: "easeOut" }}
      className="min-h-screen bg-[var(--surface-alt)] py-10 text-[var(--foreground)]"
    >
      <div className="mx-auto max-w-6xl space-y-8 px-6 md:px-10">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-2xl transition-transform duration-300 hover:-translate-y-1 ring-1 ring-white/10">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">AI Tandem Partner</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Voice-driven German roleplay</h1>
          <p className="mt-4 text-[var(--muted)]">
            Record German phrases and receive spoken roleplay feedback as a simulated language partner would.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm ring-1 ring-white/10">
            <div className="grid gap-4 sm:grid-cols-2">{scenarioCards}</div>
            <div className="mt-6 rounded-3xl bg-[var(--surface-alt)] p-5 shadow-xl transition-transform duration-300 hover:-translate-y-1 ring-1 ring-white/10">
              <div className="flex flex-col gap-3">
                <p className="text-sm text-[var(--muted)]">Selected scenario</p>
                <h2 className="text-xl font-semibold text-[var(--foreground)]">{scenarios[selectedScenario].title}</h2>
                <p className="text-[var(--muted)]">{scenarios[selectedScenario].prompt}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={startRecording}
                  disabled={isRecording}
                  className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRecording ? "Listening..." : "Start speaking"}
                </button>
                <button
                  onClick={stopRecording}
                  disabled={!isRecording}
                  className="rounded-full border border-[rgba(148,163,184,0.25)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Stop listening
                </button>
              </div>
              {error ? <p className="mt-4 text-sm text-amber-600">{error}</p> : null}
            </div>
          </div>

          <aside className="rounded-3xl bg-gradient-to-b from-slate-950 to-slate-800 p-6 text-slate-50 shadow-2xl ring-1 ring-white/10">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Session transcript</p>
              <h2 className="mt-3 text-2xl font-semibold">Live speech analysis</h2>
            </div>
            <div className="mt-5 rounded-3xl bg-slate-900 p-5 text-sm leading-7 text-slate-300">
              <p>{transcript}</p>
            </div>
            <div className="mt-6 rounded-3xl bg-slate-900 p-5 text-sm leading-7 text-slate-300">
              {feedback.map((item, index) => (
                <p key={index} className="mt-3">{item}</p>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </motion.div>
  );
}
