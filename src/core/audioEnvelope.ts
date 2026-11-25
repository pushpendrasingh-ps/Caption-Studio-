import type { GroupedCaptionPage } from './types';

export interface AudioEnergyEnvelope {
  /** Number of time slices per second (default 30 Hz) */
  slicesPerSec: number;
  /** Number of frequency/energy bands per slice (default 48) */
  bandCount: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Flattened [sliceIndex * bandCount + bandIndex] normalized 0..1 floats */
  data: Float32Array;
  /** True when computed from real decoded PCM AudioBuffer */
  isRealAudio: boolean;
}

const DEFAULT_SLICES_PER_SEC = 30;
const DEFAULT_BAND_COUNT = 48;
const FFT_SIZE = 512;
const NOISE_GATE_RMS = 0.014;

/**
 * In-place iterative Cooley-Tukey Radix-2 FFT for real+imag arrays of length N (power of 2).
 */
function radix2Fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

const HANN_WINDOW = (() => {
  const w = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  return w;
})();

/**
 * Pure PCM -> Multi-band Audio Energy Envelope analyzer (48 bands @ 30 slices/sec).
 * Uses windowed RMS noise-gate + Radix-2 FFT vocal-range frequency binning + smooth
 * attack/release filtering so bars stay completely flat (0.0) during silence and react
 * identically in both live preview and offline 1080p CFR MP4 export.
 */
export function computeAudioEnvelopeFromPcm(
  pcmSamples: Float32Array,
  sampleRate: number,
  slicesPerSec = DEFAULT_SLICES_PER_SEC,
  bandCount = DEFAULT_BAND_COUNT
): AudioEnergyEnvelope {
  const durationMs = Math.max(100, Math.round((pcmSamples.length / Math.max(1, sampleRate)) * 1000));
  const totalSlices = Math.max(1, Math.ceil((durationMs / 1000) * slicesPerSec));
  const data = new Float32Array(totalSlices * bandCount);

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const prevBands = new Float32Array(bandCount);

  // Focus bins on human vocal & podcast spectrum (~80 Hz .. 7500 Hz)
  const nyquist = sampleRate / 2;
  const maxUsefulBin = Math.min(FFT_SIZE / 2 - 1, Math.max(bandCount + 2, Math.round((7500 / nyquist) * (FFT_SIZE / 2))));
  const minBin = Math.max(1, Math.round((80 / nyquist) * (FFT_SIZE / 2)));

  let peakEnergy = 0.0001;

  // Pass 1: Compute gated FFT band energies
  for (let s = 0; s < totalSlices; s++) {
    const centerSample = Math.floor((s / slicesPerSec) * sampleRate);
    const startSample = Math.max(0, centerSample - (FFT_SIZE >> 1));

    let sumSq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const sample = startSample + i < pcmSamples.length ? pcmSamples[startSample + i] : 0;
      sumSq += sample * sample;
      re[i] = sample * HANN_WINDOW[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSq / FFT_SIZE);

    const rowOffset = s * bandCount;

    // Noise gate: below threshold -> exact 0 height (bars drop flat to 2-3px baseline)
    if (rms < NOISE_GATE_RMS) {
      for (let b = 0; b < bandCount; b++) {
        // Fast release decay to 0 so silence settles crisply to flat baseline
        const decayed = prevBands[b] * 0.42;
        const val = decayed < 0.015 ? 0 : decayed;
        prevBands[b] = val;
        data[rowOffset + b] = val;
      }
      continue;
    }

    radix2Fft(re, im);

    for (let b = 0; b < bandCount; b++) {
      // Logarithmic-ish mapping across vocal frequency range
      const t0 = b / bandCount;
      const t1 = (b + 1) / bandCount;
      const bin0 = Math.min(maxUsefulBin, Math.floor(minBin + Math.pow(t0, 1.35) * (maxUsefulBin - minBin)));
      const bin1 = Math.max(bin0 + 1, Math.min(maxUsefulBin + 1, Math.ceil(minBin + Math.pow(t1, 1.35) * (maxUsefulBin - minBin))));

      let magSum = 0;
      for (let k = bin0; k < bin1; k++) {
        magSum += Math.hypot(re[k], im[k]);
      }
      const avgMag = magSum / Math.max(1, bin1 - bin0);
      // Compress dynamic range gently + blend with frame RMS so every vocal syllable lifts smoothly
      const rawEnergy = Math.pow(avgMag / (FFT_SIZE * 0.14), 0.62) * 0.72 + Math.min(1, rms * 3.8) * 0.28;
      if (rawEnergy > peakEnergy) peakEnergy = rawEnergy;

      // Temporal attack/release smoothing
      const prev = prevBands[b];
      const smoothed = rawEnergy > prev ? prev * 0.25 + rawEnergy * 0.75 : prev * 0.58 + rawEnergy * 0.42;
      prevBands[b] = smoothed;
      data[rowOffset + b] = smoothed;
    }
  }

  // Pass 2: Normalize cleanly to [0..1] while preserving exact 0 silence
  const normScale = peakEnergy > 0.05 ? 1 / Math.min(1.8, peakEnergy * 0.92) : 1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0) {
      data[i] = Math.max(0, Math.min(1, data[i] * normScale));
    }
  }

  return {
    slicesPerSec,
    bandCount,
    durationMs,
    data,
    isRealAudio: true,
  };
}

/**
 * Convenience helper to mix down a decoded browser AudioBuffer to mono PCM and compute its envelope.
 */
export function computeAudioEnvelopeFromBuffer(buffer: AudioBuffer): AudioEnergyEnvelope {
  const len = buffer.length;
  const channels = buffer.numberOfChannels;
  let mono: Float32Array;
  if (channels === 1) {
    mono = buffer.getChannelData(0);
  } else {
    mono = new Float32Array(len);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    for (let i = 0; i < len; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  }
  return computeAudioEnvelopeFromPcm(mono, buffer.sampleRate);
}

/**
 * Deterministic voice-synced demo envelope driven by exact SRT word intervals when no custom
 * audio file is uploaded yet: rises naturally during spoken words and drops to EXACT 0.0
 * during silent gaps between words/sentences.
 */
export function buildDemoVoiceEnvelope(
  pages: GroupedCaptionPage[],
  durationMs: number,
  slicesPerSec = DEFAULT_SLICES_PER_SEC,
  bandCount = DEFAULT_BAND_COUNT
): AudioEnergyEnvelope {
  const safeDuration = Math.max(1000, Math.round(durationMs));
  const totalSlices = Math.max(1, Math.ceil((safeDuration / 1000) * slicesPerSec));
  const data = new Float32Array(totalSlices * bandCount);

  const allWords = pages.flatMap((p) => p.words);

  for (let s = 0; s < totalSlices; s++) {
    const tMs = (s / slicesPerSec) * 1000;
    const activeWord = allWords.find((w) => tMs >= w.start && tMs < w.end);
    if (!activeWord) continue;

    const wordDur = Math.max(40, activeWord.end - activeWord.start);
    const u = Math.max(0, Math.min(1, (tMs - activeWord.start) / wordDur));
    // Natural syllable amplitude arch (fast attack, smooth release)
    const syllableArch = Math.sin(u * Math.PI) * (0.75 + 0.25 * Math.sin(u * Math.PI * 3));
    const seed = (activeWord.wordIndex + 1) * 1.73 + activeWord.text.length * 0.91;

    const rowOffset = s * bandCount;
    for (let b = 0; b < bandCount; b++) {
      const pos = b / Math.max(1, bandCount - 1);
      // Center-weighted podcast formant shape
      const centerArch = 1 - Math.pow((pos - 0.5) * 1.75, 2);
      const harmonic =
        0.55 +
        0.28 * Math.sin(pos * 13.0 + tMs * 0.015 + seed) +
        0.17 * Math.cos(pos * 23.0 - tMs * 0.022 + seed * 1.4);
      const energy = Math.max(0, Math.min(1, syllableArch * Math.max(0.18, centerArch) * harmonic));
      data[rowOffset + b] = energy;
    }
  }

  return {
    slicesPerSec,
    bandCount,
    durationMs: safeDuration,
    data,
    isRealAudio: false,
  };
}

/**
 * Samples `barCount` smooth, noise-gated bar heights in [0..1] at exact timestamp `timeMs`.
 * Interpolates smoothly between adjacent 30 Hz slices so 24/30/60 fps motion is silky smooth.
 */
export function sampleEnvelopeBars(
  envelope: AudioEnergyEnvelope | null,
  timeMs: number,
  barCount: number,
  sensitivity: number,
  forceSilent = false
): Float32Array {
  const out = new Float32Array(barCount);
  if (!envelope || forceSilent || timeMs < 0) return out;

  const exactSlice = (timeMs / 1000) * envelope.slicesPerSec;
  const maxSlice = Math.floor(envelope.data.length / envelope.bandCount) - 1;
  if (maxSlice < 0) return out;

  const s0 = Math.max(0, Math.min(maxSlice, Math.floor(exactSlice)));
  const s1 = Math.max(0, Math.min(maxSlice, s0 + 1));
  const frac = Math.max(0, Math.min(1, exactSlice - s0));

  const off0 = s0 * envelope.bandCount;
  const off1 = s1 * envelope.bandCount;

  // Map symmetric/podcast-friendly band indices cleanly across requested barCount
  for (let i = 0; i < barCount; i++) {
    // Mirror low-mid frequencies slightly toward the center for a balanced podcast waveform aesthetic
    const norm = barCount > 1 ? i / (barCount - 1) : 0.5;
    const distFromCenter = Math.abs(norm - 0.5) * 2; // 0 at center, 1 at edges
    const bandFloat = distFromCenter * (envelope.bandCount - 1);
    const b0 = Math.min(envelope.bandCount - 1, Math.floor(bandFloat));
    const b1 = Math.min(envelope.bandCount - 1, b0 + 1);
    const bf = bandFloat - b0;

    const v0 = envelope.data[off0 + b0] * (1 - bf) + envelope.data[off0 + b1] * bf;
    const v1 = envelope.data[off1 + b0] * (1 - bf) + envelope.data[off1 + b1] * bf;
    const raw = v0 * (1 - frac) + v1 * frac;

    out[i] = raw <= 0.008 ? 0 : Math.min(1, raw * sensitivity);
  }

  return out;
}
