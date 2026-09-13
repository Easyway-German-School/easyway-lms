"use client";

/**
 * Free browser text-to-speech for the tutorials feature — separate from
 * AICoachPanel's German pronunciation-practice speech (de-DE, slowed down for
 * drilling); this one is English narration, tuned for an energetic voice
 * rather than clarity of a single word.
 */

const NARRATOR_VOICE_PREFERENCE =
  /female|samantha|zira|jenny|aria|victoria|google us english|google uk english female/i;

let unlocked = false;

/**
 * Call synchronously inside a click handler, before any navigation. Mobile
 * browsers only allow speechSynthesis to produce sound if it was started (or
 * unlocked) from a real user gesture — but that unlock is a property of the
 * document, not of any component, so it survives the client-side route
 * changes a tutorial makes as it moves between pages.
 */
export function unlockSpeechSynthesis() {
  if (unlocked || typeof window === "undefined" || !window.speechSynthesis) return;
  unlocked = true;
  const silent = new SpeechSynthesisUtterance("");
  silent.volume = 0;
  window.speechSynthesis.speak(silent);
}

export function pickNarratorVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const english = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (!english.length) return null;
  return english.find((voice) => NARRATOR_VOICE_PREFERENCE.test(voice.name)) ?? english[0];
}

/** Returns false when speech synthesis isn't available at all, so the caller can fall back to a timer. */
export function speak(
  text: string,
  opts: { onEnd?: () => void; onError?: () => void; rate?: number } = {},
): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) return false;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = opts.rate ?? 1.05;
  utterance.pitch = 1.1;
  utterance.onend = () => opts.onEnd?.();
  utterance.onerror = () => opts.onError?.();

  let spoken = false;
  const fire = () => {
    if (spoken) return;
    spoken = true;
    const voice = pickNarratorVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  // Android Chrome (and some others) load the voice list asynchronously —
  // speaking before it's ready produces a silent no-op with no error.
  if (window.speechSynthesis.getVoices().length) fire();
  else {
    window.speechSynthesis.addEventListener("voiceschanged", fire, { once: true });
    window.setTimeout(fire, 700);
  }
  return true;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}
