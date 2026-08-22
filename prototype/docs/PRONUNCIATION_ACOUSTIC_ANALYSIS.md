# German Pronunciation Acoustic Analysis

Status: phoneme-level scoring and cross-session memory now live (2026-08-22).

## Core Truth

Claude does not directly listen to the raw audio file through the current Anthropic API. The system therefore does not claim that Claude heard phonemes or directly judged the recording.

The current pipeline gives Claude three kinds of evidence:

1. Whisper's German speech-recognition transcript.
2. Real measurements extracted from the decoded waveform in the browser.
3. Real phoneme- and word-level accuracy from Azure's Pronunciation Assessment API, when `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` are configured — see "Phoneme-level assessment" below. This is the one piece of evidence in the pipeline that is actual forced alignment, not a proxy.

This is more honest and more useful than pretending the language model performed direct phoneme perception.

There is also no single frequency that identifies German. Speech acoustics vary by speaker, gender, age, region, microphone, room, and recording conditions. German-specific coaching should use relative acoustic patterns and the transcript together, not universal frequency thresholds.

## Current Data Flow

```text
Microphone recording
  -> MediaRecorder Blob (webm/opus, sent to Whisper)
  -> browser AudioContext decoding
       -> waveform and spectrum measurements
       -> resampled to 16kHz mono PCM WAV (sent to Azure, when configured)
  -> concurrently:
       - Groq Whisper transcription with language=de
       - Azure Pronunciation Assessment (forced alignment, phoneme-level)
       - this student's last 20 attempts, summarized
  -> Claude (funded key preferred; Groq/DeepSeek fall back) receives transcript +
     waveform measurements + Azure phoneme scores + coaching history + German rubric
  -> result, acoustic evidence, and Azure detail saved to voice-coach memory
  -> once a week: a written progress digest is regenerated from that memory
```

Relevant implementation:

- `src/components/AICoachPanel.tsx` decodes the recording, measures the waveform, and builds the 16kHz WAV Azure needs.
- `src/app/api/ai/analyze-pronunciation-audio/route.ts` runs Whisper transcription, Azure assessment, and the coaching-history lookup concurrently, then coaches and saves.
- `src/lib/ai.ts` gives the hosted text model the German acoustic coaching context, the Azure evidence, and the coaching history; `analyzePronunciation` forces the "student" AI workload so a funded `ANTHROPIC_API_KEY` is always preferred over a local model, unlike the default "interactive" workload.
- `src/lib/azure-pronunciation.ts` calls Azure's REST Pronunciation Assessment API and returns real per-word, per-phoneme accuracy.
- `src/lib/voice-coach-memory.ts` stores each attempt, summarizes the last 10 into `CoachingMemorySummary` (trend, recurring issues, weak phonemes, this student's own acoustic baseline), and regenerates the weekly digest.

## Measurements Currently Sent

- `durationSeconds`: recording duration.
- `rms`: overall signal energy/loudness proxy.
- `zeroCrossingRate`: broad signal roughness/noisiness proxy.
- `estimatedPitchHz`: pitch estimated from autocorrelation.
- `pitchConfidence`: confidence in the pitch estimate.
- `spectralCentroidHz`: weighted center of spectral energy.
- `lowBandRatio`: energy below 300 Hz.
- `lowMidBandRatio`: energy from 300 Hz to 1 kHz.
- `midBandRatio`: energy from 1 kHz to 3 kHz.
- `highMidBandRatio`: energy from 3 kHz to 8 kHz.
- `highBandRatio`: energy above 8 kHz.
- `sampleRate`: decoded audio sample rate.

The spectrum is calculated from a windowed sample of the decoded waveform. It is not presented as a phoneme classifier.

## German Coaching Signals

The model may cautiously use these measurements as broad evidence for:

- vowel-length and pacing contrasts;
- stress, prominence, and intonation;
- final-consonant clarity;
- frication or aspiration brightness, including cautious discussion of `ich` /ç/ and `machen` /x/ contexts;
- variation in German `r` pronunciation.

The transcript and acoustic evidence must support the same coaching direction before an issue is reported. A useful response should produce a short drill rather than an unsupported diagnosis.

### Important Limits

- RMS does not prove effort, confidence, or correctness.
- Pitch does not prove correct intonation or accent.
- Zero-crossing rate and spectral bands are affected by noise, compression, room acoustics, and microphone response.
- These measurements are not time-aligned to individual words or sounds.
- They cannot reliably score exact phonemes, vowel formants, or native-speaker identity.
- A language model should not claim to have heard the waveform directly.

## Persistent Memory

Each saved `voiceCoach` plan includes `acousticMemoryContext` (the honesty principles above, stored alongside the data) plus, per attempt: the transcript-derived result, score, issues, corrections, next-practice drill, the raw `acousticFeatures`, and — when Azure ran — `pronunciationScore` and the per-word/per-phoneme `azureWords` detail. The last 20 attempts are retained.

**This memory is now actually read back, not just written.** Before coaching a new attempt, both analyze routes load `getCoachingMemorySummary(studentId)` — see `buildCoachingMemorySummary` in `voice-coach-memory.ts` — which turns the last 10 attempts into:

- a word-accuracy trend (`improving` / `declining` / `steady` / `new`);
- words missed at least twice, most-missed first;
- issue themes (vowel length, final consonants, the ich/ach contrast, the German `r`, stress/rhythm) that recurred at least twice;
- the student's weakest phonemes from Azure, averaged across attempts and only surfaced when the average is genuinely low;
- **this student's own rolling acoustic baseline** (pitch, spectral centroid, RMS) — the relative-to-self comparison this doc previously only argued for. It only forms once there are at least two attempts with confident pitch detection, and it is never compared against a fixed "native speaker" number.

That summary is injected into the coaching prompt, so a recurring issue gets named as recurring rather than rediscovered from scratch every attempt, and it is returned to the client (`GET /api/ai/voice-coach-memory`) so the panel can show a "Becca remembers" line instead of silently discarding it, which the endpoint used to do.

## Phoneme-level assessment

`src/lib/azure-pronunciation.ts` calls Azure Speech's REST Pronunciation Assessment endpoint with `Granularity: "Phoneme"` and `EnableProsodyAssessment: true`, sending the same decoded recording — resampled to 16kHz mono and WAV-encoded client-side in `AICoachPanel.tsx` — that already powers the waveform measurements. It returns real, forced-aligned `AccuracyScore`/`FluencyScore`/`CompletenessScore`/`ProsodyScore`/`PronScore`, plus per-word and per-phoneme accuracy. This is genuinely time-aligned evidence, not a proxy, which closes the gap the "Dedicated speech analysis" section below used to describe as unbuilt.

It is additive: `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` are optional, and every caller degrades to exactly the pre-Azure behavior — transcript + waveform coaching only — when they are unset or the call fails. The word-match `confidence`/`wordAccuracy` fields that `recordSkillOutcome` and the student's personal-best score depend on are deliberately left untouched by this; Azure's score is surfaced as a separate `pronunciationScore` field so it does not retroactively change what a past skill-mastery point meant.

## Weekly digest

At most once every 7 days, and only as a side effect of a save (never a page load), `voice-coach-memory.ts` regenerates a short written progress note via `generateWeeklyCoachingSummary` in `ai.ts` — 2-3 sentences naming the clearest trend and the next thing worth practising, grounded only in `CoachingMemorySummary`. Needs at least 3 tracked attempts before it says anything.

## Still Building

### Better acoustic measurements

Possible next additions, now that Azure carries the phoneme-precision burden:

- time-windowed browser features instead of one summary spectrum per clip, so the waveform evidence can point at *when* in the clip something happened;
- vowel formant estimates (`F1`, `F2`) when voiced segments are reliably detected;
- pause and speech-rate detection from the waveform, to complement Azure's fluency score with a second, independent signal;
- surfacing the weekly digest and the weak-phoneme list somewhere a tutor can see it too, not just the student — the admin student dossier already exists and this data would belong there.

## Validation

`npm run typecheck` from `prototype` passes with these changes. Full interactive verification (recording real audio, a live Azure call, a live Claude call) was not run in the environment this was built in — the local dev server cannot reach the Neon database from here. Verify manually before relying on this in front of a class: record a real attempt, confirm `pronunciationScore` and the "Becca remembers" strip appear, and confirm a second attempt a few minutes later actually reads the first one's history back.
