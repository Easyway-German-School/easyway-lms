/**
 * Real phoneme-level pronunciation scoring, via Azure's Pronunciation
 * Assessment REST API.
 *
 * Everything else in the voice coach (see PRONUNCIATION_ACOUSTIC_ANALYSIS.md)
 * is deliberately honest that it CANNOT locate a sound in time or score a
 * phoneme — Whisper gives a transcript, and the browser's waveform math gives
 * whole-clip summaries. This is the layer that closes that gap: Azure Speech
 * runs actual forced alignment against the reference sentence and returns a
 * real accuracy score per word and per phoneme.
 *
 * `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` were sitting in .env.example
 * unused by any code before this file existed.
 *
 * This is additive evidence, not a replacement. If the key is missing or the
 * call fails, callers fall back to exactly what they had before — the same
 * "return null, let the caller degrade" contract every other AI call in this
 * codebase uses.
 */

export type AzurePhonemeScore = {
  phoneme: string;
  accuracyScore: number;
};

export type AzureWordScore = {
  word: string;
  accuracyScore: number;
  /** None | Omission | Insertion | Mispronunciation */
  errorType: string;
  phonemes: AzurePhonemeScore[];
};

export type AzurePronunciationAssessment = {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  prosodyScore: number | null;
  /** The aggregate score, weighted from accuracy, fluency and completeness. */
  pronScore: number;
  words: AzureWordScore[];
};

export function azurePronunciationAvailable(): boolean {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

/**
 * `wavBytes` must be 16-bit PCM, mono, 16 kHz — the one format the REST API
 * (as opposed to the fuller Speech SDK) reliably accepts alongside ogg/opus.
 * See `encodeWav16kMono` in AICoachPanel.tsx, which builds exactly this from
 * the same decoded buffer the browser already uses for the acoustic
 * measurements, so no extra recording or server-side transcoding is needed.
 */
export async function assessPronunciationWithAzure(
  wavBytes: ArrayBuffer,
  referenceText: string,
  locale = "de-DE",
): Promise<AzurePronunciationAssessment | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region || !referenceText.trim() || wavBytes.byteLength < 100) return null;

  const config = {
    ReferenceText: referenceText.trim().slice(0, 500),
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: true,
    EnableProsodyAssessment: true,
  };
  const pronunciationHeader = Buffer.from(JSON.stringify(config), "utf8").toString("base64");

  try {
    const response = await fetch(
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
          "Pronunciation-Assessment": pronunciationHeader,
        },
        body: wavBytes,
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!response.ok) {
      console.error("Azure pronunciation assessment failed", response.status, await response.text().catch(() => ""));
      return null;
    }

    const data = (await response.json()) as {
      RecognitionStatus?: string;
      NBest?: Array<{
        AccuracyScore?: number;
        FluencyScore?: number;
        ProsodyScore?: number;
        CompletenessScore?: number;
        PronScore?: number;
        Words?: Array<{
          Word?: string;
          AccuracyScore?: number;
          ErrorType?: string;
          Phonemes?: Array<{ Phoneme?: string; AccuracyScore?: number }>;
        }>;
      }>;
    };

    if (data.RecognitionStatus !== "Success") return null;
    const best = data.NBest?.[0];
    if (!best) return null;

    return {
      accuracyScore: Math.round(Number(best.AccuracyScore ?? 0)),
      fluencyScore: Math.round(Number(best.FluencyScore ?? 0)),
      completenessScore: Math.round(Number(best.CompletenessScore ?? 0)),
      prosodyScore: typeof best.ProsodyScore === "number" ? Math.round(best.ProsodyScore) : null,
      pronScore: Math.round(Number(best.PronScore ?? 0)),
      words: Array.isArray(best.Words)
        ? best.Words.filter((word) => word.Word).map((word) => ({
            word: String(word.Word),
            accuracyScore: Math.round(Number(word.AccuracyScore ?? 0)),
            errorType: String(word.ErrorType ?? "None"),
            phonemes: Array.isArray(word.Phonemes)
              ? word.Phonemes.filter((phoneme) => phoneme.Phoneme).map((phoneme) => ({
                  phoneme: String(phoneme.Phoneme),
                  accuracyScore: Math.round(Number(phoneme.AccuracyScore ?? 0)),
                }))
              : [],
          }))
        : [],
    };
  } catch (error) {
    console.error("Azure pronunciation assessment error", error);
    return null;
  }
}
