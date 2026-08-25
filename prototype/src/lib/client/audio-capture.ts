"use client";

/**
 * Browser-side mic capture helpers shared by every feature that sends audio
 * to /api/ai/analyze-pronunciation-audio (the Voice Coach drill and the
 * Tandem Partner roleplay). Both need the same 16kHz mono WAV Azure's
 * pronunciation-assessment REST API accepts, and the same waveform summary
 * stats to send alongside it — extracted here once both callers needed them,
 * instead of drifting apart as two separate copies of the same DSP.
 */

export type AcousticFeatures = {
  durationSeconds: number;
  rms: number;
  zeroCrossingRate: number;
  estimatedPitchHz: number;
  pitchConfidence: number;
  spectralCentroidHz: number;
  lowBandRatio: number;
  lowMidBandRatio: number;
  midBandRatio: number;
  highMidBandRatio: number;
  highBandRatio: number;
  sampleRate: number;
};

/**
 * Linear resample to 16 kHz mono — the one sample rate Azure's pronunciation
 * assessment REST API reliably accepts for WAV (see azure-pronunciation.ts).
 * Good enough for phoneme scoring; not meant to be broadcast-quality.
 */
export function downsampleTo16kMono(samples: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return samples;
  const ratio = inputRate / 16000;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const result = new Float32Array(outLength);
  for (let index = 0; index < outLength; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(samples.length - 1, lower + 1);
    const weight = sourceIndex - lower;
    result[index] = samples[lower] * (1 - weight) + samples[upper] * weight;
  }
  return result;
}

/** 16-bit PCM mono WAV, built by hand — no codec library needed for this. */
export function encodeWav16kMono(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 16000, true);
  view.setUint32(28, 16000 * 2, true); // byte rate = sampleRate * blockAlign
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decodes a recorded clip and returns the waveform summary stats the AI
 * coaching prompt uses (pitch, spectral balance, energy) plus a 16kHz mono
 * WAV of the same audio for Azure. Returns null on any decode failure —
 * callers degrade to transcript-only coaching, same as everywhere else in
 * this pipeline.
 */
export async function measureRecording(blob: Blob): Promise<{ features: AcousticFeatures; wavBlob: Blob } | null> {
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = buffer.getChannelData(0);
    let energy = 0;
    let crossings = 0;
    for (let index = 0; index < samples.length; index += 1) {
      energy += samples[index] * samples[index];
      if (index > 0 && (samples[index - 1] < 0) !== (samples[index] < 0)) crossings += 1;
    }
    const windowSize = Math.min(4096, samples.length);
    let bestLag = 0;
    let bestCorrelation = 0;
    for (let lag = Math.floor(buffer.sampleRate / 350); lag <= Math.floor(buffer.sampleRate / 80); lag += 1) {
      let product = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let index = 0; index < windowSize - lag; index += 1) {
        product += samples[index] * samples[index + lag];
        leftEnergy += samples[index] * samples[index];
        rightEnergy += samples[index + lag] * samples[index + lag];
      }
      const correlation = product / Math.sqrt((leftEnergy * rightEnergy) || 1);
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
    }
    const bands = { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 };
    let spectralWeight = 0;
    let spectralEnergy = 0;
    const spectrumSize = Math.min(2048, samples.length);
    for (let bin = 0; bin < spectrumSize / 2; bin += 1) {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < spectrumSize; index += 1) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (spectrumSize - 1));
        const angle = 2 * Math.PI * bin * index / spectrumSize;
        real += samples[index] * window * Math.cos(angle);
        imaginary -= samples[index] * window * Math.sin(angle);
      }
      const frequency = bin * buffer.sampleRate / spectrumSize;
      const amplitude = Math.sqrt(real * real + imaginary * imaginary);
      spectralWeight += frequency * amplitude;
      spectralEnergy += amplitude;
      if (frequency < 300) bands.low += amplitude;
      else if (frequency < 1000) bands.lowMid += amplitude;
      else if (frequency < 3000) bands.mid += amplitude;
      else if (frequency < 8000) bands.highMid += amplitude;
      else bands.high += amplitude;
    }
    const wavBlob = encodeWav16kMono(downsampleTo16kMono(samples, buffer.sampleRate));
    await context.close();
    return {
      features: {
        durationSeconds: buffer.duration,
        rms: Math.sqrt(energy / samples.length),
        zeroCrossingRate: crossings / samples.length,
        estimatedPitchHz: bestLag ? Math.round(buffer.sampleRate / bestLag) : 0,
        pitchConfidence: Math.round(Math.max(0, bestCorrelation) * 100) / 100,
        spectralCentroidHz: spectralEnergy ? Math.round(spectralWeight / spectralEnergy) : 0,
        lowBandRatio: spectralEnergy ? Math.round((bands.low / spectralEnergy) * 1000) / 1000 : 0,
        lowMidBandRatio: spectralEnergy ? Math.round((bands.lowMid / spectralEnergy) * 1000) / 1000 : 0,
        midBandRatio: spectralEnergy ? Math.round((bands.mid / spectralEnergy) * 1000) / 1000 : 0,
        highMidBandRatio: spectralEnergy ? Math.round((bands.highMid / spectralEnergy) * 1000) / 1000 : 0,
        highBandRatio: spectralEnergy ? Math.round((bands.high / spectralEnergy) * 1000) / 1000 : 0,
        sampleRate: buffer.sampleRate,
      },
      wavBlob,
    };
  } catch {
    return null;
  }
}
