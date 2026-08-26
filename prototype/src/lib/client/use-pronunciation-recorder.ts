"use client";

import { useEffect, useRef, useState } from "react";
import { measureRecording } from "@/lib/client/audio-capture";

/**
 * MediaRecorder + waveform measurement + the analyze-pronunciation-audio
 * call, extracted out of the original /tandem page so both the generic
 * chat-thread scenario picker and the visual-novel "your line" beat drive
 * one recording implementation instead of two copies of the same wiring —
 * same reuse instinct that already put the DSP itself in audio-capture.ts.
 */

export type PronunciationResult = {
  transcription: string;
  wordAccuracy: number;
  pronunciationScore: number | null;
  issues: string[];
  corrections: string[];
  missingWords: string[];
  achievementTitle: string | null;
};

export function usePronunciationRecorder(options: {
  expectedPhrase: string;
  onResult: (result: PronunciationResult) => void;
  onError?: (message: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Refs, not deps — the recorder's onstop fires asynchronously after
  // MediaRecorder.stop(), by which point the caller may have already moved
  // to a different beat/turn with a different expectedPhrase.
  const expectedPhraseRef = useRef(options.expectedPhrase);
  expectedPhraseRef.current = options.expectedPhrase;
  const onResultRef = useRef(options.onResult);
  onResultRef.current = options.onResult;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && Boolean(window.MediaRecorder) && Boolean(navigator.mediaDevices?.getUserMedia));
    return () => {
      recorderRef.current?.stop();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  async function submitRecording() {
    if (!audioChunksRef.current.length) return;
    setIsAnalyzing(true);
    try {
      const recordedBlob = new Blob(audioChunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
      const measured = await measureRecording(recordedBlob);
      const form = new FormData();
      form.append("audio", recordedBlob, "tandem-turn.webm");
      if (measured?.wavBlob) form.append("audioWav", measured.wavBlob, "tandem-turn-16k.wav");
      form.append("expectedPhrase", expectedPhraseRef.current);
      form.append("acousticFeatures", JSON.stringify(measured?.features ?? null));

      const response = await fetch("/api/ai/analyze-pronunciation-audio", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) {
        const message = data?.error || "Unable to reach the voice practice API.";
        setError(message);
        onErrorRef.current?.(message);
        return;
      }

      onResultRef.current({
        transcription: data.transcription || expectedPhraseRef.current,
        wordAccuracy: typeof data.wordAccuracy === "number" ? data.wordAccuracy : data.confidence ?? 0,
        pronunciationScore: typeof data.pronunciationScore === "number" ? data.pronunciationScore : null,
        issues: Array.isArray(data.issues) ? data.issues : [],
        corrections: Array.isArray(data.corrections) ? data.corrections : [],
        missingWords: Array.isArray(data.missingWords) ? data.missingWords : [],
        achievementTitle: typeof data.achievementTitle === "string" ? data.achievementTitle : null,
      });
    } catch {
      const message = "Unable to reach the voice practice API.";
      setError(message);
      onErrorRef.current?.(message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    if (!micSupported) {
      setError("Voice capture needs a modern browser with microphone access.");
      return;
    }
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        setIsRecording(false);
        void submitRecording();
      };
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => Math.min(60, seconds + 1)), 1000);
    } catch {
      setError("Microphone access was not available. Check your browser permission and try again.");
    }
  }

  return { isRecording, isAnalyzing, recordingSeconds, error, micSupported, toggleRecording };
}
